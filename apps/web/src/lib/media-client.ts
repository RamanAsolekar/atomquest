'use client';

import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import { io, Socket } from 'socket.io-client';
import {
  SFU_NAMESPACE,
  SfuClientEvents,
  SfuServerEvents,
  AppMediaKind,
} from '@atom/shared';
import { env } from './config';

export interface RemoteStream {
  peerId: string;
  displayName: string;
  mediaTag: AppMediaKind;
  kind: 'audio' | 'video';
  stream: MediaStream;
  consumerId: string;
}

type Events = {
  onRemoteStream: (s: RemoteStream) => void;
  onRemoteStreamClosed: (consumerId: string) => void;
  onPeerClosed: (peerId: string) => void;
  onConnectionStateChange: (state: 'connecting' | 'connected' | 'disconnected' | 'failed') => void;
};

/**
 * Browser-side mediasoup client. Establishes one send transport + one recv
 * transport to the SFU, produces local cam/mic/screen, and consumes remote
 * producers. ALL media flows through the SFU — never peer-to-peer.
 */
export class MediaClient {
  private socket: Socket | null = null;
  private device: Device | null = null;
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private producers = new Map<AppMediaKind, types.Producer>();
  private consumers = new Map<string, types.Consumer>();

  constructor(
    private sessionId: string,
    private mediaToken: string,
    private events: Events,
  ) {}

  async connect(): Promise<void> {
    this.events.onConnectionStateChange('connecting');
    // Polling-first with automatic upgrade to WebSocket is the most reliable
    // handshake across browsers/proxies. Reconnection stays on so a transient
    // network blip doesn't kill the call.
    const origin = env.mediaWsUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');
    this.socket = io(`${origin}${SFU_NAMESPACE}`, {
      path: '/sfu/',
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 15000,
      withCredentials: true,
    });

    this.socket.on('disconnect', () => this.events.onConnectionStateChange('disconnected'));
    this.socket.io.on('reconnect', () => this.rejoin());

    this.socket.on(SfuServerEvents.NEW_PRODUCER, (data) => this.consume(data.producerId, data.peerId, data.displayName, data.mediaTag, data.kind));
    this.socket.on(SfuServerEvents.PRODUCER_CLOSED, ({ consumerId }) => {
      if (consumerId) this.events.onRemoteStreamClosed(consumerId);
    });
    this.socket.on(SfuServerEvents.PEER_CLOSED, ({ peerId }) => this.events.onPeerClosed(peerId));

    // Step 1: wait for the socket to physically connect
    await new Promise<void>((resolve, reject) => {
      if (this.socket!.connected) {
        this.events.onConnectionStateChange('connected');
        return resolve();
      }

      let lastErr = '';
      const timeout = setTimeout(() => {
        this.socket?.removeAllListeners('connect_error');
        const origin = env.mediaWsUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');
        // eslint-disable-next-line no-console
        console.error('[media] connect timeout', { url: `${origin}${SFU_NAMESPACE}`, lastErr });
        reject(new Error(`Cannot reach the media server at ${origin}. ${lastErr ? `(${lastErr})` : 'Check that it is running on port 5000.'}`));
      }, 15000);

      this.socket!.once('connect', () => {
        clearTimeout(timeout);
        this.socket?.removeAllListeners('connect_error');
        this.events.onConnectionStateChange('connected');
        resolve();
      });
      // Keep listening for connect_error (reconnection may retry) but record it.
      this.socket!.on('connect_error', (err) => {
        lastErr = err.message;
        // eslint-disable-next-line no-console
        console.error('[media] connect_error', err.message);
      });
    });

    // Step 2: join the SFU room
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Media server JOIN timed out — the session may have expired.'));
      }, 10000);

      this.socket!.emit(SfuClientEvents.JOIN, { mediaToken: this.mediaToken }, async (res: any) => {
        clearTimeout(timeout);
        if (res?.error) return reject(new Error(res.error));
        try {
          this.device = new Device();
          await this.device.load({ routerRtpCapabilities: res.routerRtpCapabilities });
          await this.createTransports();
          // consume already-present producers
          for (const p of res.existingProducers ?? []) {
            await this.consume(p.producerId, p.peerId, p.displayName, p.mediaTag, p.kind);
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  private request<T = any>(event: string, data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket!.emit(event, data, (res: any) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res);
      });
    });
  }

  private async createTransports() {
    // send
    const sendParams = await this.request(SfuClientEvents.CREATE_TRANSPORT, { direction: 'send' });
    this.sendTransport = this.device!.createSendTransport(sendParams);
    this.sendTransport.on('connect', ({ dtlsParameters }, cb, errback) => {
      this.request(SfuClientEvents.CONNECT_TRANSPORT, { transportId: this.sendTransport!.id, dtlsParameters })
        .then(() => cb())
        .catch(errback);
    });
    this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, cb, errback) => {
      this.request<{ id: string }>(SfuClientEvents.PRODUCE, {
        transportId: this.sendTransport!.id,
        kind,
        rtpParameters,
        appData,
      })
        .then(({ id }) => cb({ id }))
        .catch(errback);
    });
    this.sendTransport.on('connectionstatechange', (state) => {
      if (state === 'failed') this.events.onConnectionStateChange('failed');
    });

    // recv
    const recvParams = await this.request(SfuClientEvents.CREATE_TRANSPORT, { direction: 'recv' });
    this.recvTransport = this.device!.createRecvTransport(recvParams);
    this.recvTransport.on('connect', ({ dtlsParameters }, cb, errback) => {
      this.request(SfuClientEvents.CONNECT_TRANSPORT, { transportId: this.recvTransport!.id, dtlsParameters })
        .then(() => cb())
        .catch(errback);
    });
  }

  async produce(track: MediaStreamTrack, mediaTag: AppMediaKind) {
    if (!this.sendTransport) throw new Error('send transport not ready');
    const producer = await this.sendTransport.produce({
      track,
      appData: { mediaTag },
      ...(mediaTag !== AppMediaKind.MIC
        ? {
            encodings: [
              { rid: 'r0', maxBitrate: 100_000, scalabilityMode: 'S1T3' },
              { rid: 'r1', maxBitrate: 300_000, scalabilityMode: 'S1T3' },
              { rid: 'r2', maxBitrate: 900_000, scalabilityMode: 'S1T3' },
            ],
            codecOptions: { videoGoogleStartBitrate: 1000 },
          }
        : {}),
    });
    this.producers.set(mediaTag, producer);
    return producer;
  }

  async closeProducer(mediaTag: AppMediaKind) {
    const producer = this.producers.get(mediaTag);
    if (!producer) return;
    producer.close();
    this.socket?.emit(SfuClientEvents.CLOSE_PRODUCER, { producerId: producer.id });
    this.producers.delete(mediaTag);
  }

  async pauseProducer(mediaTag: AppMediaKind) {
    const producer = this.producers.get(mediaTag);
    if (!producer) return;
    producer.pause();
    await this.request(SfuClientEvents.PAUSE_PRODUCER, { producerId: producer.id }).catch(() => {});
  }

  async resumeProducer(mediaTag: AppMediaKind) {
    const producer = this.producers.get(mediaTag);
    if (!producer) return;
    producer.resume();
    await this.request(SfuClientEvents.RESUME_PRODUCER, { producerId: producer.id }).catch(() => {});
  }

  private async consume(producerId: string, peerId: string, displayName: string, mediaTag: AppMediaKind, kind: 'audio' | 'video') {
    if (!this.recvTransport || !this.device) return;
    try {
      const res = await this.request(SfuClientEvents.CONSUME, {
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
        transportId: this.recvTransport.id,
      });
      const consumer = await this.recvTransport.consume({
        id: res.id,
        producerId: res.producerId,
        kind: res.kind,
        rtpParameters: res.rtpParameters,
      });
      this.consumers.set(consumer.id, consumer);
      await this.request(SfuClientEvents.RESUME_CONSUMER, { consumerId: consumer.id });
      const stream = new MediaStream([consumer.track]);
      this.events.onRemoteStream({ peerId, displayName, mediaTag, kind, stream, consumerId: consumer.id });
    } catch (e) {
      console.error('consume failed', e);
    }
  }

  private async rejoin() {
    // After a socket reconnect, re-establish the SFU session transparently.
    try {
      this.consumers.clear();
      await this.connect();
    } catch (e) {
      console.error('rejoin failed', e);
    }
  }

  async getStats(): Promise<'excellent' | 'good' | 'fair' | 'poor'> {
    // Sample the first video consumer's RTCStats for a coarse quality signal.
    const consumer = [...this.consumers.values()].find((c) => c.kind === 'video');
    if (!consumer) return 'good';
    try {
      const stats = await consumer.getStats();
      let packetsLost = 0;
      let packetsReceived = 0;
      stats.forEach((r: any) => {
        if (r.type === 'inbound-rtp') {
          packetsLost += r.packetsLost ?? 0;
          packetsReceived += r.packetsReceived ?? 0;
        }
      });
      const loss = packetsReceived ? packetsLost / (packetsLost + packetsReceived) : 0;
      if (loss < 0.01) return 'excellent';
      if (loss < 0.03) return 'good';
      if (loss < 0.08) return 'fair';
      return 'poor';
    } catch {
      return 'good';
    }
  }

  close() {
    this.producers.forEach((p) => p.close());
    this.consumers.forEach((c) => c.close());
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.socket?.disconnect();
  }
}
