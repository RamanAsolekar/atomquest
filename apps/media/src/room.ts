import type { types } from 'mediasoup';
import { config } from './config';
import { getNextWorker } from './workers';
import { mediaMetrics } from './metrics';
import { logger } from './logger';

export interface Peer {
  id: string; // participantId
  displayName: string;
  role: string;
  socketId: string;
  transports: Map<string, types.WebRtcTransport>;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
}

/**
 * A Room wraps one mediasoup Router (one per session). All media is routed
 * through this server — peers produce tracks to the router and consume each
 * other's tracks from it. There is never a direct peer-to-peer media path.
 */
export class Room {
  readonly id: string;
  readonly router: types.Router;
  readonly peers = new Map<string, Peer>();

  private constructor(id: string, router: types.Router) {
    this.id = id;
    this.router = router;
  }

  static async create(sessionId: string): Promise<Room> {
    const worker = getNextWorker();
    const router = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });
    mediaMetrics.rooms.inc();
    logger.info({ sessionId }, 'room created');
    return new Room(sessionId, router);
  }

  addPeer(peer: Peer) {
    this.peers.set(peer.id, peer);
    mediaMetrics.peers.inc();
  }

  getPeer(peerId: string) {
    return this.peers.get(peerId);
  }

  async createWebRtcTransport(peer: Peer) {
    const transport = await this.router.createWebRtcTransport({
      listenIps: config.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: config.webRtcTransport.initialAvailableOutgoingBitrate,
    });
    try {
      await transport.setMaxIncomingBitrate(config.webRtcTransport.maxIncomingBitrate);
    } catch {
      /* not fatal */
    }
    transport.on('dtlsstatechange', (state) => {
      if (state === 'closed') transport.close();
    });
    peer.transports.set(transport.id, transport);
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };
  }

  /** Returns producers from OTHER peers so a newly-joined peer can consume them. */
  otherProducers(peerId: string) {
    const list: { producerId: string; peerId: string; displayName: string; kind: string; mediaTag: string }[] = [];
    for (const [id, p] of this.peers) {
      if (id === peerId) continue;
      for (const producer of p.producers.values()) {
        list.push({
          producerId: producer.id,
          peerId: id,
          displayName: p.displayName,
          kind: producer.kind,
          mediaTag: (producer.appData as any).mediaTag,
        });
      }
    }
    return list;
  }

  removePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.consumers.forEach((c) => { try { c.close(); } catch {} });
    peer.producers.forEach((p) => { try { p.close(); } catch {} });
    peer.transports.forEach((t) => { try { t.close(); } catch {} });
    mediaMetrics.peers.dec();
    mediaMetrics.producers.dec(peer.producers.size);
    mediaMetrics.consumers.dec(peer.consumers.size);
    this.peers.delete(peerId);
  }

  close() {
    this.peers.forEach((_, id) => this.removePeer(id));
    try { this.router.close(); } catch {}
    mediaMetrics.rooms.dec();
    logger.info({ sessionId: this.id }, 'room closed');
  }

  isEmpty() {
    return this.peers.size === 0;
  }
}
