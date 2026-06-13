/**
 * @atom/shared — types, enums and contracts shared between the web client,
 * the FastAPI backend and the mediasoup media server. Single source of truth for
 * the wire protocol so the three services never drift apart.
 */
export * from './enums';
export * from './dto';
export * from './signaling';
export * from './constants';
