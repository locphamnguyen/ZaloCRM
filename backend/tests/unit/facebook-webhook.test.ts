/**
 * facebook-webhook.test.ts — Unit tests for webhook service:
 *   verifyChallenge, verifySignature, extractLeadgenEvents
 * No external I/O. BullMQ queue NOT tested here (Phase 04 integration tests).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyChallenge,
  verifySignature,
  extractLeadgenEvents,
} from '../../src/modules/integrations/providers/facebook/facebook-webhook-service.js';

// ── verifyChallenge ───────────────────────────────────────────────────────────

describe('verifyChallenge', () => {
  const TOKEN = 'my-verify-token-12345';

  beforeEach(() => {
    process.env.FB_WEBHOOK_VERIFY_TOKEN = TOKEN;
  });

  afterEach(() => {
    delete process.env.FB_WEBHOOK_VERIFY_TOKEN;
  });

  it('returns challenge when mode=subscribe and token matches', () => {
    const result = verifyChallenge({
      'hub.mode': 'subscribe',
      'hub.verify_token': TOKEN,
      'hub.challenge': 'abc123',
    });
    expect(result).toBe('abc123');
  });

  it('returns null when mode is not subscribe', () => {
    const result = verifyChallenge({
      'hub.mode': 'unsubscribe',
      'hub.verify_token': TOKEN,
      'hub.challenge': 'abc123',
    });
    expect(result).toBeNull();
  });

  it('returns null when verify_token does not match', () => {
    const result = verifyChallenge({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'abc123',
    });
    expect(result).toBeNull();
  });

  it('returns null when verify_token is missing', () => {
    const result = verifyChallenge({
      'hub.mode': 'subscribe',
      'hub.challenge': 'abc123',
    });
    expect(result).toBeNull();
  });

  it('returns null when challenge is missing', () => {
    const result = verifyChallenge({
      'hub.mode': 'subscribe',
      'hub.verify_token': TOKEN,
    });
    expect(result).toBeNull();
  });

  it('returns null when FB_WEBHOOK_VERIFY_TOKEN env not set', () => {
    delete process.env.FB_WEBHOOK_VERIFY_TOKEN;
    const result = verifyChallenge({
      'hub.mode': 'subscribe',
      'hub.verify_token': TOKEN,
      'hub.challenge': 'abc123',
    });
    expect(result).toBeNull();
  });
});

// ── verifySignature ───────────────────────────────────────────────────────────

describe('verifySignature', () => {
  const SECRET = 'test-app-secret-abc';

  function makeSignature(body: Buffer, secret: string): string {
    const hmac = createHmac('sha256', secret).update(body).digest('hex');
    return `sha256=${hmac}`;
  }

  beforeEach(() => {
    process.env.FB_APP_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.FB_APP_SECRET;
  });

  it('returns true for valid signature', () => {
    const body = Buffer.from('{"hello":"world"}');
    const sig = makeSignature(body, SECRET);
    expect(verifySignature(body, sig)).toBe(true);
  });

  it('returns false for wrong signature', () => {
    const body = Buffer.from('{"hello":"world"}');
    const wrongSig = makeSignature(body, 'wrong-secret');
    expect(verifySignature(body, wrongSig)).toBe(false);
  });

  it('returns false for missing header', () => {
    const body = Buffer.from('{"hello":"world"}');
    expect(verifySignature(body, undefined)).toBe(false);
  });

  it('returns false for header without sha256= prefix', () => {
    const body = Buffer.from('{"hello":"world"}');
    expect(verifySignature(body, 'md5=abcdef')).toBe(false);
  });

  it('returns false for tampered body', () => {
    const originalBody = Buffer.from('{"hello":"world"}');
    const sig = makeSignature(originalBody, SECRET);
    const tamperedBody = Buffer.from('{"hello":"evil"}');
    expect(verifySignature(tamperedBody, sig)).toBe(false);
  });

  it('returns false when FB_APP_SECRET not set', () => {
    delete process.env.FB_APP_SECRET;
    const body = Buffer.from('test');
    const sig = makeSignature(body, SECRET);
    expect(verifySignature(body, sig)).toBe(false);
  });
});

// ── extractLeadgenEvents ──────────────────────────────────────────────────────

describe('extractLeadgenEvents', () => {
  function makeWebhookBody(overrides?: object) {
    return {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: 1716000000,
          changes: [
            {
              field: 'leadgen',
              value: {
                leadgen_id: 'lead-100',
                form_id: 'form-200',
                page_id: 'page-1',
                created_time: 1716000000,
                ...overrides,
              },
            },
          ],
        },
      ],
    };
  }

  it('extracts single lead event', () => {
    const events = extractLeadgenEvents(makeWebhookBody());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      leadgenId: 'lead-100',
      formId: 'form-200',
      pageId: 'page-1',
      createdTime: 1716000000,
    });
  });

  it('extracts multiple events from multiple entries', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            { field: 'leadgen', value: { leadgen_id: 'lead-1', form_id: 'form-1', page_id: 'page-1', created_time: 1 } },
            { field: 'leadgen', value: { leadgen_id: 'lead-2', form_id: 'form-1', page_id: 'page-1', created_time: 2 } },
          ],
        },
        {
          id: 'page-2',
          changes: [
            { field: 'leadgen', value: { leadgen_id: 'lead-3', form_id: 'form-2', page_id: 'page-2', created_time: 3 } },
          ],
        },
      ],
    };
    const events = extractLeadgenEvents(body);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.leadgenId)).toEqual(['lead-1', 'lead-2', 'lead-3']);
  });

  it('skips non-leadgen change fields', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            { field: 'feed', value: { leadgen_id: 'lead-X', form_id: 'form-X', page_id: 'page-1', created_time: 1 } },
            { field: 'leadgen', value: { leadgen_id: 'lead-1', form_id: 'form-1', page_id: 'page-1', created_time: 1 } },
          ],
        },
      ],
    };
    const events = extractLeadgenEvents(body);
    expect(events).toHaveLength(1);
    expect(events[0].leadgenId).toBe('lead-1');
  });

  it('returns empty array for empty entry[]', () => {
    const events = extractLeadgenEvents({ object: 'page', entry: [] });
    expect(events).toHaveLength(0);
  });

  it('returns empty array for null body', () => {
    expect(extractLeadgenEvents(null)).toHaveLength(0);
  });

  it('returns empty array for non-object body', () => {
    expect(extractLeadgenEvents('bad string')).toHaveLength(0);
    expect(extractLeadgenEvents(42)).toHaveLength(0);
  });

  it('skips entries with missing leadgen_id', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            // missing leadgen_id
            { field: 'leadgen', value: { form_id: 'form-1', page_id: 'page-1', created_time: 1 } },
          ],
        },
      ],
    };
    expect(extractLeadgenEvents(body)).toHaveLength(0);
  });

  it('skips entries with missing form_id', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            // missing form_id
            { field: 'leadgen', value: { leadgen_id: 'lead-1', page_id: 'page-1', created_time: 1 } },
          ],
        },
      ],
    };
    expect(extractLeadgenEvents(body)).toHaveLength(0);
  });

  it('falls back to entry.id when page_id missing from value', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'entry-page-id',
          changes: [
            { field: 'leadgen', value: { leadgen_id: 'lead-1', form_id: 'form-1', created_time: 1 } },
          ],
        },
      ],
    };
    const events = extractLeadgenEvents(body);
    expect(events[0].pageId).toBe('entry-page-id');
  });
});
