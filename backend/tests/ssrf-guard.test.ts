/**
 * ssrf-guard.test.ts — Unit tests for the shared outbound URL validator
 * used by webhook-service and zapier-webhook (phase 05 of security plan).
 */
import { describe, it, expect } from 'vitest';
import { assertSafeOutboundUrl, isSafeOutboundUrl, SsrfBlockedError } from '../src/shared/utils/ssrf-guard.js';

describe('ssrf-guard', () => {
  describe('rejects', () => {
    const blocked: Array<[string, string]> = [
      ['http (non-https)', 'http://example.com/hook'],
      ['file://', 'file:///etc/passwd'],
      ['gopher://', 'gopher://internal:70/'],
      ['IPv4 loopback', 'https://127.0.0.1/hook'],
      ['localhost literal', 'https://localhost/hook'],
      ['AWS metadata IP', 'https://169.254.169.254/latest/meta-data/'],
      ['GCP metadata host range', 'https://169.254.170.2/'],
      ['RFC1918 10/8', 'https://10.0.0.5/hook'],
      ['RFC1918 172.16/12', 'https://172.20.0.1/hook'],
      ['RFC1918 192.168/16', 'https://192.168.1.10/hook'],
      ['0.0.0.0 this-network', 'https://0.0.0.0/'],
      ['IPv6 loopback ::1', 'https://[::1]/hook'],
      ['IPv6 link-local fe80::', 'https://[fe80::1]/hook'],
      ['IPv6 ULA fc00::', 'https://[fc00::1]/hook'],
      ['IPv6 ULA fd00::', 'https://[fd12:3456::1]/hook'],
    ];

    for (const [label, url] of blocked) {
      it(`blocks ${label}`, () => {
        expect(() => assertSafeOutboundUrl(url)).toThrow(SsrfBlockedError);
        expect(isSafeOutboundUrl(url)).toBe(false);
      });
    }

    it('rejects malformed URLs', () => {
      expect(() => assertSafeOutboundUrl('not a url')).toThrow(SsrfBlockedError);
    });
  });

  describe('accepts', () => {
    const allowed = [
      'https://example.com/hook',
      'https://hooks.zapier.com/hooks/catch/123/abc',
      'https://api.openai.com/v1/chat/completions',
      'https://api.telegram.org/bot123/sendMessage',
      'https://203.0.113.50/edge', // public IP literal
    ];
    for (const url of allowed) {
      it(`allows ${url}`, () => {
        expect(() => assertSafeOutboundUrl(url)).not.toThrow();
        expect(isSafeOutboundUrl(url)).toBe(true);
      });
    }

    it('returns the parsed URL on success', () => {
      const u = assertSafeOutboundUrl('https://example.com/hook?x=1');
      expect(u.hostname).toBe('example.com');
      expect(u.searchParams.get('x')).toBe('1');
    });
  });

  it('error carries the offending URL for log context', () => {
    try {
      assertSafeOutboundUrl('https://127.0.0.1/secrets');
    } catch (err) {
      expect(err).toBeInstanceOf(SsrfBlockedError);
      expect((err as SsrfBlockedError).url).toBe('https://127.0.0.1/secrets');
    }
  });
});
