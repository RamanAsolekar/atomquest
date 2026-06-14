import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { config } from './config';
import { logger } from './logger';
import { createWorkers, closeWorkers } from './workers';
import { attachSignaling, getRoom } from './signaling';
import { startRecording, stopRecording, stopAll } from './recorder';
import { stopAllTranscription } from './transcriber';
import { registry } from './metrics';

async function main() {
  await createWorkers();

  const app = express();
  app.use(express.json());

  // Health & metrics
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'atom-media' }));
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  // Recording control — invoked by the API (which has already authorised the agent).
  app.post('/recording/start', async (req, res) => {
    const { sessionId, recordingId } = req.body ?? {};
    const room = getRoom(sessionId);
    if (!room) return res.status(404).json({ error: 'room not found' });
    await startRecording(room, recordingId, sessionId);
    res.json({ ok: true });
  });

  app.post('/recording/stop', async (req, res) => {
    const { sessionId } = req.body ?? {};
    await stopRecording(sessionId);
    res.json({ ok: true });
  });

  const httpServer = createServer(app);
  // Default socket.io path (/socket.io/). Browsers reach the SFU either directly
  // (dev: http://localhost:5000) or through nginx at /sfu/ which rewrites the
  // prefix back to /socket.io/ (prod: same-origin). The SFU lives on the /sfu
  // *namespace* — that is independent of the HTTP path.
  // When CORS_ORIGINS is set, only those origins may connect directly; otherwise
  // reflect the request origin (dev). credentials:false — same-origin proxying
  // (the production path) sends no cookies, and reflecting an origin WITH
  // credentials is the combination strict browsers reject.
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      credentials: false,
    },
    maxHttpBufferSize: 1e6,
  });
  attachSignaling(io);

  httpServer.listen(config.port, '0.0.0.0', () => {
    logger.info(
      `🎥 Atom media server (mediasoup SFU) on :${config.port} — workers=${config.numWorkers}, announcedIp=${config.webRtcTransport.listenIps[0].announcedIp}`,
    );
  });

  const shutdown = async () => {
    logger.info('Shutting down media server…');
    await stopAll();
    await stopAllTranscription();
    await closeWorkers();
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  logger.error(e, 'media server failed to start');
  process.exit(1);
});
