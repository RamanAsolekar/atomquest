import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { types } from 'mediasoup';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config';
import { logger } from './logger';
import { mediaMetrics } from './metrics';
import { Room } from './room';

/**
 * Server-side recording. We attach a PlainTransport to the room router, pipe
 * the audio + video producers into it, and point FFmpeg at an SDP describing
 * those RTP streams. FFmpeg muxes to a .webm/.mp4 file which we upload to S3.
 *
 * This keeps recording fully self-hosted — no third-party media service.
 */
interface ActiveRecording {
  recordingId: string;
  sessionId: string;
  process: ChildProcess;
  filePath: string;
  transports: types.PlainTransport[];
  consumers: types.Consumer[];
  startedAt: number;
}

const active = new Map<string, ActiveRecording>();
let nextPort = config.recordingRtp.minPort;

function allocPort() {
  const p = nextPort;
  nextPort += 2;
  if (nextPort > config.recordingRtp.maxPort) nextPort = config.recordingRtp.minPort;
  return p;
}

const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
});

export async function startRecording(room: Room, recordingId: string, sessionId: string): Promise<void> {
  if (!config.recordingEnabled) {
    logger.warn('Recording disabled by config');
    return;
  }
  if (active.has(sessionId)) return;

  // Pick the first available audio + video producer in the room.
  let audioProducer: types.Producer | undefined;
  let videoProducer: types.Producer | undefined;
  for (const peer of room.peers.values()) {
    for (const p of peer.producers.values()) {
      if (p.kind === 'audio' && !audioProducer) audioProducer = p;
      if (p.kind === 'video' && !videoProducer) videoProducer = p;
    }
  }

  const dir = path.join(os.tmpdir(), 'atom-recordings');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${recordingId}.webm`);

  const transports: types.PlainTransport[] = [];
  const consumers: types.Consumer[] = [];
  const sdpParts: string[] = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=AtomRecording', 'c=IN IP4 127.0.0.1', 't=0 0'];

  async function pipe(producer: types.Producer | undefined, kind: 'audio' | 'video') {
    if (!producer) return;
    const port = allocPort();
    const transport = await room.router.createPlainTransport({
      listenIp: config.recordingRtp.listenIp,
      rtcpMux: true,
      comedia: false,
    });
    await transport.connect({ ip: '127.0.0.1', port });
    transports.push(transport);

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: room.router.rtpCapabilities,
      paused: true,
    });
    consumers.push(consumer);
    const codec = consumer.rtpParameters.codecs[0];
    const payload = codec.payloadType;
    const rate = codec.clockRate;
    const encName = codec.mimeType.split('/')[1];

    if (kind === 'audio') {
      sdpParts.push(`m=audio ${port} RTP/AVP ${payload}`);
      sdpParts.push(`a=rtpmap:${payload} ${encName}/${rate}/2`);
      sdpParts.push('a=recvonly');
    } else {
      sdpParts.push(`m=video ${port} RTP/AVP ${payload}`);
      sdpParts.push(`a=rtpmap:${payload} ${encName}/${rate}`);
      sdpParts.push('a=recvonly');
    }
    // resume after FFmpeg is listening
    setTimeout(() => consumer.resume().catch(() => {}), 1000);
  }

  await pipe(audioProducer, 'audio');
  await pipe(videoProducer, 'video');

  const sdpPath = path.join(dir, `${recordingId}.sdp`);
  fs.writeFileSync(sdpPath, sdpParts.join('\n') + '\n');

  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-protocol_whitelist', 'file,udp,rtp',
      '-fflags', '+genpts',
      '-i', sdpPath,
      '-c', 'copy',
      '-f', 'webm',
      '-y',
      filePath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  ffmpeg.stderr?.on('data', (d) => logger.debug(`[ffmpeg ${recordingId}] ${d}`));
  ffmpeg.on('error', (e) => logger.error(`ffmpeg spawn error: ${e.message}`));

  active.set(sessionId, {
    recordingId,
    sessionId,
    process: ffmpeg,
    filePath,
    transports,
    consumers,
    startedAt: Date.now(),
  });
  mediaMetrics.recordingsActive.inc();
  logger.info({ sessionId, recordingId }, 'recording started');
}

export async function stopRecording(sessionId: string): Promise<void> {
  const rec = active.get(sessionId);
  if (!rec) return;
  active.delete(sessionId);
  mediaMetrics.recordingsActive.dec();

  // Gracefully stop FFmpeg
  rec.process.kill('SIGINT');
  await new Promise((r) => {
    rec.process.on('close', r);
    setTimeout(r, 5000);
  });
  rec.consumers.forEach((c) => { try { c.close(); } catch {} });
  rec.transports.forEach((t) => { try { t.close(); } catch {} });

  const durationSeconds = Math.round((Date.now() - rec.startedAt) / 1000);

  // Upload to S3 then notify the API.
  try {
    const buffer = fs.existsSync(rec.filePath) ? fs.readFileSync(rec.filePath) : Buffer.alloc(0);
    const storageKey = `${rec.sessionId}/${rec.recordingId}.webm`;
    if (buffer.length > 0) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: storageKey,
          Body: buffer,
          ContentType: 'video/webm',
        }),
      );
    }
    await notifyApi({
      recordingId: rec.recordingId,
      storageKey,
      sizeBytes: buffer.length,
      durationSeconds,
      error: buffer.length === 0 ? 'No media captured' : undefined,
    });
    try { fs.unlinkSync(rec.filePath); } catch {}
    logger.info({ sessionId, recordingId: rec.recordingId, sizeBytes: buffer.length }, 'recording finalised');
  } catch (e) {
    logger.error(`Recording finalise failed: ${(e as Error).message}`);
    await notifyApi({ recordingId: rec.recordingId, storageKey: '', sizeBytes: 0, error: (e as Error).message });
  }
}

async function notifyApi(payload: object) {
  try {
    await fetch(`${config.apiCallbackUrl}/api/recordings/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    logger.error(`API callback failed: ${(e as Error).message}`);
  }
}

export function stopAll() {
  return Promise.all([...active.keys()].map((s) => stopRecording(s)));
}
