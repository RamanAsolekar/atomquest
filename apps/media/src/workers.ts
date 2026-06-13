import * as mediasoup from 'mediasoup';
import type { types } from 'mediasoup';
import { config } from './config';
import { logger } from './logger';

/**
 * Worker pool. mediasoup runs each Worker in a separate C++ subprocess; we
 * spread routers (rooms) across workers round-robin to use all CPU cores.
 */
const workers: types.Worker[] = [];
let nextWorkerIdx = 0;

export async function createWorkers(): Promise<void> {
  for (let i = 0; i < config.numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: config.worker.logLevel,
      logTags: config.worker.logTags,
      rtcMinPort: config.worker.rtcMinPort,
      rtcMaxPort: config.worker.rtcMaxPort,
    });
    worker.on('died', () => {
      logger.error(`mediasoup worker ${worker.pid} died — exiting for orchestrator restart`);
      setTimeout(() => process.exit(1), 2000);
    });
    workers.push(worker);
    logger.info(`mediasoup worker ${i + 1}/${config.numWorkers} started (pid ${worker.pid})`);
  }
}

export function getNextWorker(): types.Worker {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

export async function closeWorkers(): Promise<void> {
  for (const w of workers) w.close();
}
