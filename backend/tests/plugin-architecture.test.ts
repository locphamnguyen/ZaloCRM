/**
 * Plugin architecture (open-core) — unit tests cho 2 primitive + license gating.
 * Xem plans/260602-2229-open-core-plugin-architecture/.
 */
import { describe, it, expect } from 'vitest';
import { createCapabilityRegistry } from '../src/plugin-api/capability-registry.js';
import { createPolicyRegistry } from '../src/plugin-api/policy-registry.js';
import { loadLicense } from '../src/core/license-service.js';

describe('CapabilityRegistry (primitive 1)', () => {
  it('provide rồi get đúng impl', () => {
    const reg = createCapabilityRegistry();
    const impl = { ping: () => 'pong' };
    reg.provide('demo.cap', impl);
    expect(reg.has('demo.cap')).toBe(true);
    expect(reg.get<typeof impl>('demo.cap').ping()).toBe('pong');
  });

  it('get key chưa provide → throw', () => {
    const reg = createCapabilityRegistry();
    expect(() => reg.get('missing')).toThrow(/not provided/);
  });

  it('provide trùng key → throw (tránh ghi đè ngầm)', () => {
    const reg = createCapabilityRegistry();
    reg.provide('dup', {});
    expect(() => reg.provide('dup', {})).toThrow(/already provided/);
  });

  it('has trả false cho key chưa có (không throw)', () => {
    expect(createCapabilityRegistry().has('nope')).toBe(false);
  });
});

describe('PolicyRegistry (primitive 2)', () => {
  it('chưa register → check trả TRUE (community không bị khóa)', async () => {
    const reg = createPolicyRegistry();
    expect(await reg.check('chat.view', { req: {} })).toBe(true);
  });

  it('đã register → check theo logic policy', async () => {
    const reg = createPolicyRegistry();
    reg.register('chat.view', async ({ resourceId }) => resourceId === 'ok');
    expect(await reg.check('chat.view', { req: {}, resourceId: 'ok' })).toBe(true);
    expect(await reg.check('chat.view', { req: {}, resourceId: 'no' })).toBe(false);
  });

  it('register trùng name → throw', () => {
    const reg = createPolicyRegistry();
    reg.register('p', async () => true);
    expect(() => reg.register('p', async () => false)).toThrow(/already registered/);
  });
});

describe('LicenseService stub (Phase 3)', () => {
  const ENV = 'ZALOCRM_LICENSE_FEATURES';

  it('không có env → community, has() luôn false', () => {
    const prev = process.env[ENV];
    delete process.env[ENV];
    const lic = loadLicense();
    expect(lic.edition()).toBe('community');
    expect(lic.has('chat.ai_suggest')).toBe(false);
    if (prev !== undefined) process.env[ENV] = prev;
  });

  it('có env feature → enterprise, bật đúng feature', () => {
    const prev = process.env[ENV];
    process.env[ENV] = 'chat.ai_suggest, analytics.advanced';
    const lic = loadLicense();
    expect(lic.edition()).toBe('enterprise');
    expect(lic.has('chat.ai_suggest')).toBe(true);
    expect(lic.has('analytics.advanced')).toBe(true);
    expect(lic.has('not.licensed')).toBe(false);
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  });
});
