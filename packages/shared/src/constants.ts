/** Reconnect grace window — how long we hold a participant's slot after a drop. */
export const RECONNECT_GRACE_MS = 15_000;

/** Max upload size for in-chat file sharing (25 MB). */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Allowed mime types for file sharing (validated server-side, not just by extension). */
export const ALLOWED_FILE_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
];

/** Max chat message length. */
export const MAX_MESSAGE_LENGTH = 4000;

/** Max participants per support session (1 agent + 1 customer + admin observers). */
export const MAX_PARTICIPANTS = 8;

/** Heartbeat / connection-quality reporting interval. */
export const STATS_INTERVAL_MS = 3000;

/** Standard media codecs negotiated by the SFU. */
export const SESSION_CODE_LENGTH = 12;
