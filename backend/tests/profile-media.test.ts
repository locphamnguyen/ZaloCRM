/**
 * profile-media.test.ts — Tests for profile operations, video processor,
 * voice sender, and credential routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mockUser } from './test-helpers.js';

// ── Prisma mock ───────────────────────────────────────────────────────────────
const prismaMock = {
  zaloAccount: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  zaloAccountAccess: {
    findFirst: vi.fn(),
  },
};

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser(); },
}));
vi.mock('../src/modules/zalo/zalo-route-helpers.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue({ id: 'za-1', orgId: 'org-1' }),
  checkAccess: vi.fn().mockResolvedValue(true),
  handleError: vi.fn().mockImplementation((reply: any, err: any) => {
    reply.status(500).send({ error: err?.message || 'Error' });
  }),
}));

beforeEach(() => { vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════════
// video-processor.ts unit tests (pure logic — no mocks needed)
// ═══════════════════════════════════════════════════════════════════════════════
describe('video-processor: planVideoSendMode', () => {
  it('returns attachment mode when ffmpeg unavailable', async () => {
    const { planVideoSendMode } = await import('../src/shared/video-processor.js');
    const result = planVideoSendMode({ files: ['video.mp4'], ffmpegAvailable: false });
    expect(result.mode).toBe('attachment');
    expect((result as any).reason).toContain('ffmpeg');
  });

  it('returns attachment mode for multiple files', async () => {
    const { planVideoSendMode } = await import('../src/shared/video-processor.js');
    const result = planVideoSendMode({ files: ['a.mp4', 'b.mp4'], ffmpegAvailable: true });
    expect(result.mode).toBe('attachment');
    expect((result as any).reason).toContain('one video');
  });

  it('returns attachment mode for non-mp4', async () => {
    const { planVideoSendMode } = await import('../src/shared/video-processor.js');
    const result = planVideoSendMode({ files: ['video.avi'], ffmpegAvailable: true });
    expect(result.mode).toBe('attachment');
    expect((result as any).reason).toContain('.mp4');
  });

  it('returns native mode for single .mp4 with ffmpeg available', async () => {
    const { planVideoSendMode } = await import('../src/shared/video-processor.js');
    const result = planVideoSendMode({ files: ['video.mp4'], ffmpegAvailable: true });
    expect(result.mode).toBe('native');
  });
});

describe('video-processor: parseVideoProbeOutput', () => {
  it('parses valid ffprobe JSON with stream duration', async () => {
    const { parseVideoProbeOutput } = await import('../src/shared/video-processor.js');
    const raw = JSON.stringify({
      streams: [{ codec_type: 'video', width: 1920, height: 1080, duration: '10.5' }],
      format: {},
    });
    const meta = parseVideoProbeOutput(raw);
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.durationMs).toBe(10500);
  });

  it('falls back to format duration when stream duration missing', async () => {
    const { parseVideoProbeOutput } = await import('../src/shared/video-processor.js');
    const raw = JSON.stringify({
      streams: [{ codec_type: 'video', width: 640, height: 480 }],
      format: { duration: '5.0' },
    });
    const meta = parseVideoProbeOutput(raw);
    expect(meta.durationMs).toBe(5000);
  });

  it('returns empty metadata for missing video stream', async () => {
    const { parseVideoProbeOutput } = await import('../src/shared/video-processor.js');
    const raw = JSON.stringify({ streams: [{ codec_type: 'audio' }], format: {} });
    const meta = parseVideoProbeOutput(raw);
    expect(meta.durationMs).toBeUndefined();
    expect(meta.width).toBeUndefined();
    expect(meta.height).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// voice-sender.ts unit tests
// ═══════════════════════════════════════════════════════════════════════════════
describe('voice-sender: sendVoiceFile', () => {
  it('throws INVALID_PARAMS for unsupported extension', async () => {
    const { sendVoiceFile } = await import('../src/shared/voice-sender.js');
    await expect(
      sendVoiceFile({ api: {}, threadId: 't1', threadType: 0, audioPath: '/tmp/test.mkv' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('throws INVALID_PARAMS for missing file', async () => {
    const { sendVoiceFile } = await import('../src/shared/voice-sender.js');
    await expect(
      sendVoiceFile({ api: {}, threadId: 't1', threadType: 0, audioPath: '/nonexistent/file.mp3' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// credential-routes.ts integration tests
// ═══════════════════════════════════════════════════════════════════════════════
const { credentialRoutes } = await import('../src/modules/zalo/credential-routes.js');

function buildCredApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(credentialRoutes);
  return app;
}

const BASE_CRED = '/api/v1/zalo-accounts/za-1/credentials';

describe('GET /credentials/export', () => {
  it('returns 404 when account not found', async () => {
    prismaMock.zaloAccount.findFirst.mockResolvedValue(null);
    const res = await buildCredApp().inject({ method: 'GET', url: `${BASE_CRED}/export` });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when no session data saved', async () => {
    prismaMock.zaloAccount.findFirst.mockResolvedValue({
      id: 'za-1', sessionData: null, displayName: 'Test',
    });
    const res = await buildCredApp().inject({ method: 'GET', url: `${BASE_CRED}/export` });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringContaining('No credentials') });
  });

  it('exports credentials JSON when session exists', async () => {
    const creds = { cookie: { z: '1' }, imei: 'imei-123', userAgent: 'ua' };
    prismaMock.zaloAccount.findFirst.mockResolvedValue({
      id: 'za-1', sessionData: creds, displayName: 'Test',
    });
    const res = await buildCredApp().inject({ method: 'GET', url: `${BASE_CRED}/export` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment');
    const body = JSON.parse(res.body);
    expect(body.imei).toBe('imei-123');
  });
});

describe('POST /credentials/import', () => {
  it('returns 404 when account not found', async () => {
    prismaMock.zaloAccount.findFirst.mockResolvedValue(null);
    const res = await buildCredApp().inject({
      method: 'POST', url: `${BASE_CRED}/import`,
      payload: { cookie: {}, imei: 'x', userAgent: 'ua' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid credential shape', async () => {
    prismaMock.zaloAccount.findFirst.mockResolvedValue({ id: 'za-1' });
    const res = await buildCredApp().inject({
      method: 'POST', url: `${BASE_CRED}/import`,
      payload: { imei: 'x' }, // missing cookie and userAgent
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({
      error: expect.stringContaining('Invalid credential'),
    });
  });

  it('saves valid credentials and returns success', async () => {
    prismaMock.zaloAccount.findFirst.mockResolvedValue({ id: 'za-1' });
    prismaMock.zaloAccount.update.mockResolvedValue({ id: 'za-1' });
    const res = await buildCredApp().inject({
      method: 'POST', url: `${BASE_CRED}/import`,
      payload: { cookie: { z: '1' }, imei: 'imei-abc', userAgent: 'Mozilla/5.0' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ success: true });
    expect(prismaMock.zaloAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'za-1' } }),
    );
  });

  it('returns 500 when db update fails', async () => {
    prismaMock.zaloAccount.findFirst.mockResolvedValue({ id: 'za-1' });
    prismaMock.zaloAccount.update.mockRejectedValue(new Error('DB error'));
    const res = await buildCredApp().inject({
      method: 'POST', url: `${BASE_CRED}/import`,
      payload: { cookie: { z: '1' }, imei: 'imei-abc', userAgent: 'Mozilla/5.0' },
    });
    expect(res.statusCode).toBe(500);
  });
});
