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
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1e6,
    path: '/sfu/',
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
