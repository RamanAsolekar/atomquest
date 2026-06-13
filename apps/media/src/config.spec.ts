import { config } from './config';

describe('media config', () => {
  it('exposes the three required codecs (opus, VP8, H264)', () => {
    const mimes = config.router.mediaCodecs.map((c) => c.mimeType);
    expect(mimes).toContain('audio/opus');
    expect(mimes).toContain('video/VP8');
    expect(mimes).toContain('video/H264');
  });

  it('allocates a sane RTC port range', () => {
    expect(config.worker.rtcMaxPort).toBeGreaterThan(config.worker.rtcMinPort);
  });

  it('always sets an announced IP for ICE reachability', () => {
    expect(config.webRtcTransport.listenIps[0].announcedIp).toBeTruthy();
  });
});
