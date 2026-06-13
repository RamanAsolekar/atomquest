import * as os from 'os';
import type { types as mediasoupTypes } from 'mediasoup';

export const config = {
  port: parseInt(process.env.MEDIA_PORT ?? '5000', 10),
  jwtSecret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret',
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

  webRtcTransport: {
    // The announced IP is what clients use to reach the server. In production
    // set MEDIA_ANNOUNCED_IP to the public/EC2 IP so ICE candidates are reachable.
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: process.env.MEDIA_ANNOUNCED_IP ?? '127.0.0.1',
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
