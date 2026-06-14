'use client';

import { io, Socket } from 'socket.io-client';
import { RT_NAMESPACE, RtClientEvents, RtServerEvents } from '@atom/shared';
import { env } from './config';

/** Socket.IO client for the API realtime namespace: chat, presence, annotations. */
export class RealtimeClient {
  socket: Socket;

  constructor(mediaToken: string) {
    // When wsUrl is '' (same-origin browser mode) use window.location.origin so
    // the socket.io handshake goes to the current host and nginx proxies /socket.io/.
    const origin = env.wsUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');
    this.socket = io(`${origin}${RT_NAMESPACE}`, {
      // Polling-first then upgrade — same proxy-safe strategy as the media
      // client. WebSocket-only silently dies if the upgrade is blocked, which
      // made chat/presence appear "not working" even though the room connected.
      transports: ['polling', 'websocket'],
      upgrade: true,
      auth: { mediaToken },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      withCredentials: false,
    });

    // Make connection problems visible instead of failing silently.
    this.socket.on('connect', () => console.info('[rt] connected via', (this.socket as any)?.io?.engine?.transport?.name));
    this.socket.on('connect_error', (e) => console.error('[rt] connect_error', e.message));
    this.socket.on('rt:error', (e: any) => console.error('[rt] server error', e?.message ?? e));
  }

  on(event: string, handler: (...args: any[]) => void) {
    this.socket.on(event, handler);
    return () => this.socket.off(event, handler);
  }

  sendMessage(text: string) {
    this.socket.emit(RtClientEvents.SEND_MESSAGE, { text });
  }
  typing(typing: boolean) {
    this.socket.emit(RtClientEvents.TYPING, { typing });
  }
  toggleMedia(patch: { audioEnabled?: boolean; videoEnabled?: boolean; screenSharing?: boolean }) {
    this.socket.emit(RtClientEvents.TOGGLE_MEDIA, patch);
  }
  annotate(stroke: unknown) {
    this.socket.emit(RtClientEvents.ANNOTATE, stroke);
  }
  clearAnnotations() {
    this.socket.emit(RtClientEvents.CLEAR_ANNOTATIONS);
  }
  pointer(x: number, y: number) {
    this.socket.emit(RtClientEvents.POINTER, { x, y });
  }
  heartbeat(quality: string) {
    this.socket.emit(RtClientEvents.HEARTBEAT, { quality });
  }
  endSession() {
    this.socket.emit(RtClientEvents.END_SESSION);
  }
  close() {
    this.socket.disconnect();
  }
}

export { RtServerEvents, RtClientEvents };
