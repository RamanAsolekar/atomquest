import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import type { types } from 'mediasoup';
import { config } from './config';
import { logger } from './logger';
import { mediaMetrics } from './metrics';
import { Room } from './room';

/**
 * Live speech-to-text. For each session we:
 *   1. consume the room's audio producer(s) onto a mediasoup PlainTransport
 *   2. FFmpeg decodes the Opus RTP → 16 kHz mono s16le PCM on stdout
 *   3. that PCM is piped into a persistent faster-whisper worker (Python) which
 *      emits JSON transcript segments on stdout
 *   4. we POST each finalised segment to the backend /api/transcripts/ingest,
 *      which persists it and broadcasts it live into the call (AI panel).
 *
 * Fully self-hosted — no third-party transcription API.
 */
interface ActiveStt {
  sessionId: string;
  ffmpeg: ChildProcess;
  whisper: ChildProcess;
  transports: types.PlainTransport[];
  consumers: types.Consumer[];
}

const active = new Map<string, ActiveStt>();
let nextPort = config.sttRtp.minPort;

function allocPort(): number {
  const p = nextPort;
  nextPort += 2;
  if (nextPort > config.sttRtp.maxPort) nextPort = config.sttRtp.minPort;
  return p;
}

export async function startTranscription(room: Room, sessionId: string): Promise<void> {
  if (!config.stt.enabled || active.has(sessionId)) return;
  if (!fs.existsSync(config.stt.workerScript)) {
    logger.warn({ script: config.stt.workerScript }, 'whisper worker script missing; STT disabled');
    return;
  }

  // pick the first available audio producer
  let audioProducer: types.Producer | undefined;
  for (const peer of room.peers.values()) {
    for (const p of peer.producers.values()) {
      if (p.kind === 'audio') {
        audioProducer = p;
        break;
      }
    }
    if (audioProducer) break;
  }
  if (!audioProducer) {
    logger.info({ sessionId }, 'no audio producer yet for STT; will retry on next producer');
    return;
  }

  const port = allocPort();
  const transport = await room.router.createPlainTransport({
    listenIp: config.sttRtp.listenIp,
    rtcpMux: true,
    comedia: false,
  });
  await transport.connect({ ip: '127.0.0.1', port });
  const consumer = await transport.consume({
    producerId: audioProducer.id,
    rtpCapabilities: room.router.rtpCapabilities,
    paused: true,
  });
  const codec = consumer.rtpParameters.codecs[0];
  const payload = codec.payloadType;

  const dir = path.join(os.tmpdir(), 'atom-stt');
  fs.mkdirSync(dir, { recursive: true });
  const sdpPath = path.join(dir, `${sessionId}.sdp`);
  fs.writeFileSync(
    sdpPath,
    [
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=AtomSTT',
      'c=IN IP4 127.0.0.1',
      't=0 0',
      `m=audio ${port} RTP/AVP ${payload}`,
      `a=rtpmap:${payload} opus/48000/2`,
      'a=recvonly',
    ].join('\n') + '\n',
  );

  // FFmpeg: Opus RTP → 16 kHz mono s16le PCM on stdout
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-protocol_whitelist', 'file,udp,rtp',
      '-i', sdpPath,
      '-ac', '1',
      '-ar', '16000',
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );

  // Persistent faster-whisper worker: reads raw PCM on stdin, writes JSON lines.
  const whisper = spawn(
    config.stt.pythonBin,
    [config.stt.workerScript, '--model', config.stt.model, '--device', config.stt.device, '--compute-type', config.stt.computeType],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );

  ffmpeg.stdout?.pipe(whisper.stdin!);

  const rl = readline.createInterface({ input: whisper.stdout! });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    try {
      const seg = JSON.parse(trimmed);
      if (seg.text) postTranscript(sessionId, seg);
    } catch {
      /* partial line */
    }
  });

  ffmpeg.on('error', (e) => logger.error(`STT ffmpeg error: ${e.message}`));
  whisper.on('error', (e) => logger.error(`whisper worker error: ${e.message}`));

  setTimeout(() => consumer.resume().catch(() => {}), 800);

  active.set(sessionId, { sessionId, ffmpeg, whisper, transports: [transport], consumers: [consumer] });
  mediaMetrics.sttActive?.inc();
  logger.info({ sessionId, model: config.stt.model }, 'live transcription started');
}

async function postTranscript(sessionId: string, seg: { text: string; start?: number; end?: number; speaker?: string }) {
  try {
    await fetch(`${config.apiCallbackUrl}/api/transcripts/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        text: seg.text,
        speaker: seg.speaker ?? 'caller',
        startMs: seg.start != null ? Math.round(seg.start * 1000) : undefined,
        endMs: seg.end != null ? Math.round(seg.end * 1000) : undefined,
        isFinal: true,
      }),
    });
  } catch (e) {
    logger.warn(`transcript POST failed: ${(e as Error).message}`);
  }
}

export async function stopTranscription(sessionId: string): Promise<void> {
  const stt = active.get(sessionId);
  if (!stt) return;
  active.delete(sessionId);
  mediaMetrics.sttActive?.dec();
  try { stt.ffmpeg.kill('SIGINT'); } catch {}
  try { stt.whisper.stdin?.end(); stt.whisper.kill('SIGINT'); } catch {}
  stt.consumers.forEach((c) => { try { c.close(); } catch {} });
  stt.transports.forEach((t) => { try { t.close(); } catch {} });
  logger.info({ sessionId }, 'live transcription stopped');
}

export function stopAllTranscription() {
  return Promise.all([...active.keys()].map((s) => stopTranscription(s)));
}
