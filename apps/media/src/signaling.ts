import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import type { types } from 'mediasoup';
import {
  SFU_NAMESPACE,
  SfuClientEvents,
  SfuServerEvents,
} from '@atom/shared';
import { config } from './config';
import { logger } from './logger';
import { Room, Peer } from './room';
import { mediaMetrics } from './metrics';
import { startRecording, stopRecording } from './recorder';
import { startTranscription, stopTranscription } from './transcriber';

const rooms = new Map<string, Room>();

async function getOrCreateRoom(sessionId: string): Promise<Room> {
  let room = rooms.get(sessionId);
  if (!room) {
    room = await Room.create(sessionId);
    rooms.set(sessionId, room);
  }
  return room;
}

interface MediaTokenPayload {
  sub: string;
  sessionId: string;
  role: string;
  displayName: string;
  type: string;
}

export function attachSignaling(io: Server): void {
  const sfu = io.of(SFU_NAMESPACE);

  sfu.on('connection', (socket: Socket) => {
    let room: Room | undefined;
    let peer: Peer | undefined;

    const ack = (cb: unknown, data: unknown) => typeof cb === 'function' && (cb as Function)(data);
    const fail = (cb: unknown, message: string) => {
      mediaMetrics.transportErrors.inc();
      typeof cb === 'function' && (cb as Function)({ error: message });
      socket.emit(SfuServerEvents.ERROR, { message });
    };

    // ---- JOIN: validate media token, create router-side peer ----
    socket.on(SfuClientEvents.JOIN, async ({ mediaToken }: { mediaToken: string }, cb) => {
      try {
        const payload = jwt.verify(mediaToken, config.jwtSecret) as MediaTokenPayload;
        if (payload.type !== 'media') throw new Error('bad token');
        room = await getOrCreateRoom(payload.sessionId);
        peer = {
          id: payload.sub,
          displayName: payload.displayName,
          role: payload.role,
          socketId: socket.id,
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
        };
        room.addPeer(peer);
        socket.join(payload.sessionId);
        socket.data.sessionId = payload.sessionId;

        ack(cb, {
          routerRtpCapabilities: room.router.rtpCapabilities,
          existingProducers: room.otherProducers(peer.id),
        });
        logger.info({ sessionId: payload.sessionId, peer: peer.displayName }, 'SFU join');
      } catch (e) {
        fail(cb, 'Invalid media token');
        socket.disconnect(true);
      }
    });

    socket.on(SfuClientEvents.CREATE_TRANSPORT, async (_data, cb) => {
      if (!room || !peer) return fail(cb, 'not joined');
      try {
        const params = await room.createWebRtcTransport(peer);
        ack(cb, params);
      } catch (e) {
        fail(cb, `createTransport failed: ${(e as Error).message}`);
      }
    });

    socket.on(SfuClientEvents.CONNECT_TRANSPORT, async ({ transportId, dtlsParameters }, cb) => {
      const transport = peer?.transports.get(transportId);
      if (!transport) return fail(cb, 'transport not found');
      try {
        await transport.connect({ dtlsParameters });
        ack(cb, { connected: true });
      } catch (e) {
        fail(cb, `connectTransport failed: ${(e as Error).message}`);
      }
    });

    // ---- PRODUCE: peer publishes a track to the router ----
    socket.on(SfuClientEvents.PRODUCE, async ({ transportId, kind, rtpParameters, appData }, cb) => {
      const transport = peer?.transports.get(transportId);
      if (!transport || !room || !peer) return fail(cb, 'transport not found');
      try {
        const producer = await transport.produce({
          kind,
          rtpParameters,
          appData: { ...appData, peerId: peer.id },
        });
        peer.producers.set(producer.id, producer);
        mediaMetrics.producers.inc();
        producer.on('transportclose', () => producer.close());

        // Tell everyone else there's a new producer to consume.
        socket.to(room.id).emit(SfuServerEvents.NEW_PRODUCER, {
          producerId: producer.id,
          peerId: peer.id,
          displayName: peer.displayName,
          mediaTag: appData?.mediaTag,
          kind,
        });

        // First audio track in the room → kick off live transcription.
        if (kind === 'audio') {
          startTranscription(room, room.id).catch((e) =>
            logger.warn(`startTranscription failed: ${(e as Error).message}`),
          );
        }
        ack(cb, { id: producer.id });
      } catch (e) {
        fail(cb, `produce failed: ${(e as Error).message}`);
      }
    });

    // ---- CONSUME: peer receives another peer's track from the router ----
    socket.on(SfuClientEvents.CONSUME, async ({ producerId, rtpCapabilities, transportId }, cb) => {
      if (!room || !peer) return fail(cb, 'not joined');
      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        return fail(cb, 'cannot consume');
      }
      const transport = transportId
        ? peer.transports.get(transportId)
        : [...peer.transports.values()][0];
      if (!transport) return fail(cb, 'no recv transport');
      try {
        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true, // resumed by client after handling
        });
        peer.consumers.set(consumer.id, consumer);
        mediaMetrics.consumers.inc();
        consumer.on('transportclose', () => consumer.close());
        consumer.on('producerclose', () => {
          socket.emit(SfuServerEvents.PRODUCER_CLOSED, { consumerId: consumer.id, producerId });
          peer?.consumers.delete(consumer.id);
          mediaMetrics.consumers.dec();
        });
        ack(cb, {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (e) {
        fail(cb, `consume failed: ${(e as Error).message}`);
      }
    });

    socket.on(SfuClientEvents.RESUME_CONSUMER, async ({ consumerId }, cb) => {
      const consumer = peer?.consumers.get(consumerId);
      if (consumer) await consumer.resume();
      ack(cb, { resumed: true });
    });

    socket.on(SfuClientEvents.PAUSE_PRODUCER, async ({ producerId }, cb) => {
      const producer = peer?.producers.get(producerId);
      if (producer) await producer.pause();
      ack(cb, { paused: true });
    });

    socket.on(SfuClientEvents.RESUME_PRODUCER, async ({ producerId }, cb) => {
      const producer = peer?.producers.get(producerId);
      if (producer) await producer.resume();
      ack(cb, { resumed: true });
    });

    socket.on(SfuClientEvents.CLOSE_PRODUCER, ({ producerId }) => {
      const producer = peer?.producers.get(producerId);
      if (producer && room && peer) {
        producer.close();
        peer.producers.delete(producerId);
        mediaMetrics.producers.dec();
        socket.to(room.id).emit(SfuServerEvents.PRODUCER_CLOSED, { producerId, peerId: peer.id });
      }
    });

    socket.on(SfuClientEvents.RESTART_ICE, async ({ transportId }, cb) => {
      const transport = peer?.transports.get(transportId) as types.WebRtcTransport | undefined;
      if (!transport) return fail(cb, 'transport not found');
      const iceParameters = await transport.restartIce();
      ack(cb, { iceParameters });
    });

    // ---- recording control (relayed from API; agent-authorised there) ----
    socket.on(SfuClientEvents.START_RECORDING, async ({ recordingId }, cb) => {
      if (!room) return fail(cb, 'not joined');
      await startRecording(room, recordingId, room.id);
      ack(cb, { recording: true });
    });

    socket.on(SfuClientEvents.STOP_RECORDING, async (_d, cb) => {
      if (!room) return fail(cb, 'not joined');
      await stopRecording(room.id);
      ack(cb, { recording: false });
    });

    socket.on('disconnect', () => {
      if (!room || !peer) return;
      const sessionId = room.id;
      socket.to(sessionId).emit(SfuServerEvents.PEER_CLOSED, { peerId: peer.id });
      room.removePeer(peer.id);
      if (room.isEmpty()) {
        stopRecording(sessionId).catch(() => {});
        stopTranscription(sessionId).catch(() => {});
        room.close();
        rooms.delete(sessionId);
      }
      logger.info({ sessionId, peer: peer.displayName }, 'SFU disconnect');
    });
  });
}

export function getRoom(sessionId: string) {
  return rooms.get(sessionId);
}
