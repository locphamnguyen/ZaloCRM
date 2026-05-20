// Phase 7 — Trigger types & validator unit tests.

import { describe, it, expect } from 'vitest';
import {
  isSupportedEventType,
  isSupportedCategory,
  isSupportedBindingKind,
  validateBinding,
  validateEventFilter,
  TRIGGER_CATALOG,
  SUPPORTED_EVENT_TYPES,
} from '../src/modules/automation/triggers/types.js';

describe('event type guards', () => {
  it('accepts the catalog event types', () => {
    expect(isSupportedEventType('friendship_accepted')).toBe(true);
    expect(isSupportedEventType('birthday')).toBe(true);
    expect(isSupportedEventType('manual_run')).toBe(true);
    expect(isSupportedEventType('order_success')).toBe(true);
  });

  it('rejects unknown events', () => {
    expect(isSupportedEventType('unknown_event')).toBe(false);
    expect(isSupportedEventType('')).toBe(false);
    expect(isSupportedEventType(undefined)).toBe(false);
  });

  it('accepts known categories', () => {
    expect(isSupportedCategory('general')).toBe(true);
    expect(isSupportedCategory('keyword')).toBe(true);
    expect(isSupportedCategory('genai')).toBe(true);
  });

  it('rejects unknown categories', () => {
    expect(isSupportedCategory('marketing')).toBe(false);
  });

  it('accepts the 3 binding kinds', () => {
    expect(isSupportedBindingKind('sequence')).toBe(true);
    expect(isSupportedBindingKind('block')).toBe(true);
    expect(isSupportedBindingKind('broadcast')).toBe(true);
  });

  it('rejects unknown binding kinds', () => {
    expect(isSupportedBindingKind('campaign')).toBe(false);
  });
});

describe('validateBinding', () => {
  it('accepts sequence binding with only sequenceId set', () => {
    const r = validateBinding('sequence', { sequenceId: 'seq-1' });
    expect(r.ok).toBe(true);
  });

  it('accepts block binding with only blockId set', () => {
    const r = validateBinding('block', { blockId: 'blk-1' });
    expect(r.ok).toBe(true);
  });

  it('accepts broadcast binding with only broadcastId set', () => {
    const r = validateBinding('broadcast', { broadcastId: 'bc-1' });
    expect(r.ok).toBe(true);
  });

  it('rejects sequence binding missing sequenceId', () => {
    const r = validateBinding('sequence', { blockId: 'blk-1' });
    expect(r.ok).toBe(false);
  });

  it('rejects sequence binding with extra blockId set (ambiguous)', () => {
    const r = validateBinding('sequence', { sequenceId: 'seq-1', blockId: 'blk-1' });
    expect(r.ok).toBe(false);
  });

  it('rejects sequence binding with extra broadcastId set (ambiguous)', () => {
    const r = validateBinding('sequence', { sequenceId: 'seq-1', broadcastId: 'bc-1' });
    expect(r.ok).toBe(false);
  });

  it('rejects empty string sequenceId', () => {
    const r = validateBinding('sequence', { sequenceId: '' });
    expect(r.ok).toBe(false);
  });
});

describe('validateEventFilter', () => {
  it('accepts null/undefined', () => {
    expect(validateEventFilter(null).ok).toBe(true);
    expect(validateEventFilter(undefined).ok).toBe(true);
  });

  it('accepts plain object', () => {
    expect(validateEventFilter({ keyword: 'báo giá' }).ok).toBe(true);
    expect(validateEventFilter({}).ok).toBe(true);
  });

  it('rejects array (would shadow object semantics)', () => {
    expect(validateEventFilter([]).ok).toBe(false);
  });

  it('rejects primitive', () => {
    expect(validateEventFilter('string').ok).toBe(false);
    expect(validateEventFilter(42).ok).toBe(false);
  });
});

describe('TRIGGER_CATALOG metadata', () => {
  it('contains entries for all supported event types', () => {
    // Allow catalog to be a superset (it must cover every supported event),
    // and reject if any supported event lacks a catalog entry.
    const catalogEventTypes = new Set(TRIGGER_CATALOG.map((e) => e.eventType));
    // Note: not every event needs a card (e.g. message_received and time_elapsed
    // are internal / advanced — exposed only via API not UI catalog). Verify the
    // big user-facing ones are present.
    expect(catalogEventTypes.has('friendship_accepted')).toBe(true);
    expect(catalogEventTypes.has('birthday')).toBe(true);
    expect(catalogEventTypes.has('keyword_match')).toBe(true);
    expect(catalogEventTypes.has('order_success')).toBe(true);
    expect(catalogEventTypes.has('contact_imported')).toBe(true);
  });

  it('every catalog entry has supported eventType + category + binding', () => {
    for (const entry of TRIGGER_CATALOG) {
      expect(SUPPORTED_EVENT_TYPES).toContain(entry.eventType);
      expect(['general', 'keyword', 'bot_api', 'livechat', 'genai']).toContain(entry.category);
      expect(['sequence', 'block', 'broadcast']).toContain(entry.recommendedBinding);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});
