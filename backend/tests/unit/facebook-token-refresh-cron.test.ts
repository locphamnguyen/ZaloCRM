/**
 * facebook-token-refresh-cron.test.ts — Unit tests for token refresh cron.
 *
 * Tests:
 *  1. Skip pages where tokenExpiresAt > now + 7d (not in query window)
 *  2. Refresh path: probe returns 200 → status stays connected, tokenExpiresAt updated
 *  3. Token dead path: probe returns 401 → status='error', ActivityLog written
 *  4. Network/transient error: probe throws → status unchanged, no ActivityLog
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Shared mock state ─────────────────────────────────────────────────────────

let mockConnections: Array<{
  id: string;
  orgId: string;
  pageId: string;
  pageName: string;
  accessTokenEnc: string;
  tokenExpiresAt: Date | null;
}> = [];

const mockUpdateSpy = vi.fn().mockResolvedValue({});
const mockFindManySpy = vi.fn().mockImplementation(() => Promise.resolve(mockConnections));
const mockActivityCreateSpy = vi.fn().mockResolvedValue({});

// ── Mock: Prisma ──────────────────────────────────────────────────────────────

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: {
    facebookPageConnection: {
      findMany: mockFindManySpy,
      update: mockUpdateSpy,
    },
    activityLog: {
      create: mockActivityCreateSpy,
    },
  },
}));

// ── Mock: aes-gcm ─────────────────────────────────────────────────────────────

vi.mock('../../src/shared/crypto/aes-gcm.js', () => ({
  decrypt: vi.fn((enc: string) => enc === 'INVALID_ENC' ? (() => { throw new Error('bad key'); })() : `decrypted_${enc}`),
  encrypt: vi.fn((plain: string) => `encrypted_${plain}`),
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────

vi.mock('../../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Mock: activity-logger ─────────────────────────────────────────────────────

vi.mock('../../src/modules/activity/activity-logger.js', () => ({
  logActivity: vi.fn(),
}));

// ── Mock: global fetch ────────────────────────────────────────────────────────

let mockFetchImpl: () => Promise<Response>;

vi.stubGlobal('fetch', vi.fn((..._args: unknown[]) => mockFetchImpl()));

// ── Import SUT after mocks ────────────────────────────────────────────────────

const { runRefreshCycleNow } = await import('../../src/modules/integrations/providers/facebook/facebook-token-refresh-cron.js');
const { logActivity } = await import('../../src/modules/activity/activity-logger.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConnection(overrides: Partial<typeof mockConnections[0]> = {}) {
  return {
    id: 'conn-1',
    orgId: 'org-1',
    pageId: 'page-123',
    pageName: 'Test Page',
    accessTokenEnc: 'valid_enc',
    tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3d from now (within 7d window)
    ...overrides,
  };
}

function makeOkResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: 'page-123', access_token: 'page_token' }),
    text: async () => '{"id":"page-123"}',
  } as unknown as Response;
}

function make4xxResponse(status = 401): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { code: 190, message: 'Token invalid' } }),
  } as unknown as Response;
}

function make5xxResponse(): Response {
  return {
    ok: false,
    status: 503,
    text: async () => 'Service Unavailable',
  } as unknown as Response;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('facebook-token-refresh-cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnections = [];
    mockUpdateSpy.mockResolvedValue({});
    mockFindManySpy.mockImplementation(() => Promise.resolve(mockConnections));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns early with no work when no connections in window', async () => {
    mockConnections = [];
    const summary = await runRefreshCycleNow();
    expect(summary.checked).toBe(0);
    expect(summary.refreshed).toBe(0);
    expect(summary.errors).toBe(0);
    expect(mockUpdateSpy).not.toHaveBeenCalled();
  });

  it('extends tokenExpiresAt when Graph probe returns 200 (token alive)', async () => {
    mockConnections = [makeConnection()];
    mockFetchImpl = () => Promise.resolve(makeOkResponse());

    const summary = await runRefreshCycleNow();

    expect(summary.checked).toBe(1);
    expect(summary.refreshed).toBe(1);
    expect(summary.errors).toBe(0);

    expect(mockUpdateSpy).toHaveBeenCalledOnce();
    const updateCall = mockUpdateSpy.mock.calls[0][0];
    expect(updateCall.where.id).toBe('conn-1');
    expect(updateCall.data.lastError).toBeNull();
    // tokenExpiresAt should be ~50 days in future
    const newExpiry = updateCall.data.tokenExpiresAt as Date;
    const daysFromNow = (newExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysFromNow).toBeGreaterThan(48);
    expect(daysFromNow).toBeLessThan(52);

    // status should NOT be updated to error
    expect(updateCall.data.status).toBeUndefined();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('marks connection status=error and logs ActivityLog when Graph returns 401', async () => {
    mockConnections = [makeConnection()];
    mockFetchImpl = () => Promise.resolve(make4xxResponse(401));

    const summary = await runRefreshCycleNow();

    expect(summary.checked).toBe(1);
    expect(summary.refreshed).toBe(0);
    expect(summary.errors).toBe(0); // error counter is for unexpected throws, not token-dead

    expect(mockUpdateSpy).toHaveBeenCalledOnce();
    const updateCall = mockUpdateSpy.mock.calls[0][0];
    expect(updateCall.data.status).toBe('error');
    expect(typeof updateCall.data.lastError).toBe('string');

    // ActivityLog must be written for admin notification
    expect(logActivity).toHaveBeenCalledOnce();
    const logCall = (logActivity as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logCall.action).toBe('page_token_expired');
    expect(logCall.orgId).toBe('org-1');
    expect(logCall.systemSource).toBe('fb_token_refresh_cron');
  });

  it('marks status=error for 403 response (revoked access)', async () => {
    mockConnections = [makeConnection()];
    mockFetchImpl = () => Promise.resolve(make4xxResponse(403));

    await runRefreshCycleNow();

    const updateCall = mockUpdateSpy.mock.calls[0][0];
    expect(updateCall.data.status).toBe('error');
    expect(logActivity).toHaveBeenCalledOnce();
  });

  it('does NOT change status on 5xx response (transient error)', async () => {
    mockConnections = [makeConnection()];
    mockFetchImpl = () => Promise.resolve(make5xxResponse());

    const summary = await runRefreshCycleNow();

    // No DB update for transient errors
    expect(mockUpdateSpy).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();

    // refreshed=0 but also no errors counter incremented for transient
    expect(summary.refreshed).toBe(0);
  });

  it('does NOT change status on network error (fetch throws)', async () => {
    mockConnections = [makeConnection()];
    mockFetchImpl = () => Promise.reject(new Error('ECONNREFUSED'));

    const summary = await runRefreshCycleNow();

    expect(mockUpdateSpy).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(summary.refreshed).toBe(0);
  });

  it('marks error and logs when decrypt fails (corrupted token)', async () => {
    mockConnections = [makeConnection({ accessTokenEnc: 'INVALID_ENC' })];
    // Fetch should not be called at all
    mockFetchImpl = () => Promise.reject(new Error('should not be called'));

    await runRefreshCycleNow();

    expect(mockUpdateSpy).toHaveBeenCalledOnce();
    const updateCall = mockUpdateSpy.mock.calls[0][0];
    expect(updateCall.data.status).toBe('error');
    expect(logActivity).toHaveBeenCalledOnce();
  });

  it('processes multiple connections independently (one error does not stop others)', async () => {
    mockConnections = [
      makeConnection({ id: 'conn-1', pageName: 'Page 1' }),
      makeConnection({ id: 'conn-2', pageName: 'Page 2', accessTokenEnc: 'valid_enc_2' }),
    ];

    let callCount = 0;
    mockFetchImpl = () => {
      callCount++;
      // First call: 401 (dead), second call: 200 (alive)
      if (callCount === 1) return Promise.resolve(make4xxResponse(401));
      return Promise.resolve(makeOkResponse());
    };

    const summary = await runRefreshCycleNow();

    expect(summary.checked).toBe(2);
    expect(summary.refreshed).toBe(1); // second conn refreshed
    expect(mockUpdateSpy).toHaveBeenCalledTimes(2);

    // First conn → error
    const firstUpdate = mockUpdateSpy.mock.calls[0][0];
    expect(firstUpdate.where.id).toBe('conn-1');
    expect(firstUpdate.data.status).toBe('error');

    // Second conn → extended expiry
    const secondUpdate = mockUpdateSpy.mock.calls[1][0];
    expect(secondUpdate.where.id).toBe('conn-2');
    expect(secondUpdate.data.status).toBeUndefined();
    expect(secondUpdate.data.tokenExpiresAt).toBeInstanceOf(Date);
  });
});
