import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'atom_media_' });

export const mediaMetrics = {
  rooms: new Gauge({
    name: 'atom_media_rooms',
    help: 'Active mediasoup rooms (sessions)',
    registers: [registry],
  }),
  peers: new Gauge({
    name: 'atom_media_peers',
    help: 'Connected media peers',
    registers: [registry],
  }),
  producers: new Gauge({
    name: 'atom_media_producers',
    help: 'Active producers (published tracks)',
    registers: [registry],
  }),
  consumers: new Gauge({
    name: 'atom_media_consumers',
    help: 'Active consumers (received tracks)',
    registers: [registry],
  }),
  transportErrors: new Counter({
    name: 'atom_media_transport_errors_total',
    help: 'Transport connection errors',
    registers: [registry],
  }),
  recordingsActive: new Gauge({
    name: 'atom_media_recordings_active',
    help: 'Recordings currently capturing',
    registers: [registry],
  }),
  sttActive: new Gauge({
    name: 'atom_media_stt_active',
    help: 'Live transcription sessions running',
    registers: [registry],
  }),
};
