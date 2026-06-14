import * as os from 'os';
import type { types as mediasoupTypes } from 'mediasoup';
import { logger } from './logger';

/**
 * Resolve the IP the SFU ANNOUNCES to browsers in its ICE candidates — i.e. the
 * address every participant's browser will send/receive WebRTC media to. This is
 * the single most common reason a Meet/Zoom-style call "connects" (signaling is
 * fine) but no audio/video ever flows: if this is a private/loopback IP, remote
 * peers are told to send media to an address they cannot reach.
 *
 * Order of preference:
 *   1. MEDIA_ANNOUNCED_IP / PUBLIC_HOST — explicit, what you MUST set in prod.
 *   2. First non-internal IPv4 of the host — works for LAN joins out of the box.
 *   3. 127.0.0.1 — same-machine only; we WARN loudly because cross-device fails.
 */
function resolveAnnouncedIp(): string {
  const explicit = (process.env.MEDIA_ANNOUNCED_IP || process.env.PUBLIC_HOST || '').trim();
  // PUBLIC_HOST may be a hostname (e.g. "meet.example.com"); only accept a bare
  // IPv4 here — hostnames are not valid ICE candidate addresses.
  const isIpv4 = (v: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v);
  if (explicit && explicit !== 'localhost' && isIpv4(explicit)) return explicit;

  // Auto-detect the host's primary LAN IPv4 so same-network devices work with
  // zero config (the common dev/demo case).
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        logger.warn(
          `MEDIA_ANNOUNCED_IP not set — auto-detected LAN IP ${a.address}. ` +
            'This works for same-network devices. For internet joins set ' +
            'MEDIA_ANNOUNCED_IP to the public/EC2 IP and configure TURN.',
        );
        return a.address;
      }
    }
  }

  logger.error(
    'MEDIA_ANNOUNCED_IP unset and no LAN IP found — falling back to 127.0.0.1. ' +
      'Only same-machine calls will work; remote participants CANNOT connect.',
  );
  return '127.0.0.1';
}

const announcedIp = resolveAnnouncedIp();

/**
 * ICE servers handed to the browser so it can traverse NAT/firewalls — exactly
 * how Google Meet reaches users behind restrictive networks. STUN alone covers
 * most home routers; TURN (relay) is REQUIRED for symmetric NAT / corporate
 * firewalls that block direct UDP. Set TURN_URL / TURN_USER / TURN_PASS to
 * enable the bundled coturn relay.
 */
function buildIceServers(): { urls: string | string[]; username?: string; credential?: string }[] {
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: (process.env.STUN_URL || 'stun:stun.l.google.com:19302').split(',') },
  ];
  const turnUrl = (process.env.TURN_URL || '').trim();
  if (turnUrl) {
    servers.push({
      urls: turnUrl.split(','),
      username: process.env.TURN_USER || 'atom',
      credential: process.env.TURN_PASS || 'atom_turn_secret',
    });
  } else {
    logger.warn(
      'TURN not configured (TURN_URL empty). Participants behind symmetric NAT ' +
        'or strict firewalls may fail to connect. Enable the coturn service for ' +
        'reliable internet joins.',
    );
  }
  return servers;
}

export const config = {
  port: parseInt(process.env.MEDIA_PORT ?? '5000', 10),
  jwtSecret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret',
  // Allowed browser origins for direct (non-proxied) connections. When the app
  // is served same-origin through nginx these aren't needed, but the dev escape
  // hatch (browser → http://localhost:5000) requires the page origin here.
  // Comma-separated; empty → reflect the request origin (dev convenience only).
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  apiCallbackUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
  recordingEnabled: (process.env.RECORDING_ENABLED ?? 'true') === 'true',

  // Live speech-to-text (self-hosted faster-whisper worker, co-located).
  stt: {
    enabled: (process.env.STT_ENABLED ?? 'true') === 'true',
    model: process.env.WHISPER_MODEL ?? 'base.en',
    device: process.env.WHISPER_DEVICE ?? 'cpu',
    computeType: process.env.WHISPER_COMPUTE_TYPE ?? 'int8',
    pythonBin: process.env.WHISPER_PYTHON ?? 'python3',
    workerScript: process.env.WHISPER_WORKER ?? '/repo/apps/media/whisper_worker.py',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY ?? 'atom_minio',
    secretKey: process.env.S3_SECRET_KEY ?? 'atom_minio_secret',
    bucket: process.env.S3_BUCKET_RECORDINGS ?? 'atom-recordings',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  },

  numWorkers: Math.min(
    parseInt(process.env.MEDIA_NUM_WORKERS ?? String(Math.max(1, os.cpus().length)), 10),
    os.cpus().length,
  ),

  worker: {
    rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT ?? '40000', 10),
    rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT ?? '40100', 10),
    logLevel: 'warn' as mediasoupTypes.WorkerLogLevel,
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'] as mediasoupTypes.WorkerLogTag[],
  },

  // Codecs the SFU will route. VP8 + Opus = broad browser support; H264 included.
  router: {
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: { 'x-google-start-bitrate': 1000 },
      },
      {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1,
        },
      },
    ] as mediasoupTypes.RtpCodecCapability[],
  },

  // ICE servers (STUN/TURN) sent to the browser for NAT traversal — handed out
  // in the SFU JOIN ack so the client's transports can reach the SFU from any
  // network, the same way Google Meet does.
  iceServers: buildIceServers(),

  webRtcTransport: {
    // `announcedIp` is the address the SFU puts in its ICE candidates — what
    // every browser is told to send media to. Resolved above (explicit → LAN →
    // loopback) so cross-device calls don't silently break on 127.0.0.1.
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp,
      },
    ],
    initialAvailableOutgoingBitrate: 1_000_000,
    minimumAvailableOutgoingBitrate: 600_000,
    maxIncomingBitrate: 1_500_000,
  },

  recordingRtp: {
    minPort: parseInt(process.env.RECORDING_RTP_MIN_PORT ?? '41000', 10),
    maxPort: parseInt(process.env.RECORDING_RTP_MAX_PORT ?? '41100', 10),
    listenIp: '127.0.0.1',
  },

  sttRtp: {
    minPort: parseInt(process.env.STT_RTP_MIN_PORT ?? '42000', 10),
    maxPort: parseInt(process.env.STT_RTP_MAX_PORT ?? '42100', 10),
    listenIp: '127.0.0.1',
  },
};
