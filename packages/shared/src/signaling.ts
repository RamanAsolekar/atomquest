import type { AppMediaKind } from './enums';

/**
 * Socket.IO event names. Two namespaces:
 *  - the API server (`/rt`) handles chat, presence, session lifecycle, annotations.
 *  - the media server (`/sfu`) handles mediasoup signaling (transports, produce/consume).
 */
export const RT_NAMESPACE = '/rt';
export const SFU_NAMESPACE = '/sfu';

// ---------- Media server (mediasoup) signaling ----------
export const SfuClientEvents = {
  JOIN: 'sfu:join',
  GET_RTP_CAPABILITIES: 'sfu:getRtpCapabilities',
  CREATE_TRANSPORT: 'sfu:createTransport',
  CONNECT_TRANSPORT: 'sfu:connectTransport',
  PRODUCE: 'sfu:produce',
  CONSUME: 'sfu:consume',
  RESUME_CONSUMER: 'sfu:resumeConsumer',
  CLOSE_PRODUCER: 'sfu:closeProducer',
  PAUSE_PRODUCER: 'sfu:pauseProducer',
  RESUME_PRODUCER: 'sfu:resumeProducer',
  RESTART_ICE: 'sfu:restartIce',
  STATS: 'sfu:stats',
  START_RECORDING: 'sfu:startRecording',
  STOP_RECORDING: 'sfu:stopRecording',
  LEAVE: 'sfu:leave',
} as const;

export const SfuServerEvents = {
  JOINED: 'sfu:joined',
  NEW_PRODUCER: 'sfu:newProducer',
  PRODUCER_CLOSED: 'sfu:producerClosed',
  PEER_CLOSED: 'sfu:peerClosed',
  PRODUCER_PAUSED: 'sfu:producerPaused',
  PRODUCER_RESUMED: 'sfu:producerResumed',
  RECORDING_STATUS: 'sfu:recordingStatus',
  ERROR: 'sfu:error',
} as const;

export interface SfuJoinPayload {
  sessionId: string;
  mediaToken: string; // signed by API, validated by media server
}

export interface TransportParams {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown[];
  dtlsParameters: unknown;
  sctpParameters?: unknown;
}

export interface ProducePayload {
  transportId: string;
  kind: 'audio' | 'video';
  rtpParameters: unknown;
  appData: { mediaTag: AppMediaKind; peerId: string };
}

export interface ConsumePayload {
  producerId: string;
  rtpCapabilities: unknown;
}

export interface NewProducerNotification {
  producerId: string;
  peerId: string;
  displayName: string;
  mediaTag: AppMediaKind;
  kind: 'audio' | 'video';
}

// ---------- Realtime API namespace (chat / presence / annotations) ----------
export const RtClientEvents = {
  JOIN_ROOM: 'rt:joinRoom',
  LEAVE_ROOM: 'rt:leaveRoom',
  SEND_MESSAGE: 'rt:sendMessage',
  TYPING: 'rt:typing',
  TOGGLE_MEDIA: 'rt:toggleMedia',
  ANNOTATE: 'rt:annotate',
  CLEAR_ANNOTATIONS: 'rt:clearAnnotations',
  POINTER: 'rt:pointer',
  END_SESSION: 'rt:endSession',
  HEARTBEAT: 'rt:heartbeat',
} as const;

export const RtServerEvents = {
  ROOM_STATE: 'rt:roomState',
  MESSAGE: 'rt:message',
  TYPING: 'rt:typing',
  PARTICIPANT_JOINED: 'rt:participantJoined',
  PARTICIPANT_UPDATED: 'rt:participantUpdated',
  PARTICIPANT_LEFT: 'rt:participantLeft',
  PARTICIPANT_RECONNECTING: 'rt:participantReconnecting',
  MEDIA_TOGGLED: 'rt:mediaToggled',
  ANNOTATION: 'rt:annotation',
  ANNOTATIONS_CLEARED: 'rt:annotationsCleared',
  POINTER: 'rt:pointer',
  SESSION_ENDED: 'rt:sessionEnded',
  RECORDING_STATUS: 'rt:recordingStatus',
  AI_INSIGHT: 'rt:aiInsight',
  TRANSCRIPT: 'rt:transcript',
  ERROR: 'rt:error',
} as const;

export interface AnnotationStroke {
  id: string;
  tool: 'pen' | 'arrow' | 'rect' | 'highlight' | 'text';
  color: string;
  points: number[]; // normalised 0..1 coords flattened [x,y,x,y...]
  text?: string;
  authorName: string;
}

export interface PointerEvent {
  peerId: string;
  displayName: string;
  x: number; // normalised 0..1
  y: number;
}
