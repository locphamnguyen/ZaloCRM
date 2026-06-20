// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * ssrf-guard.ts — Validate an outbound URL before fetching it.
 *
 * Blocks SSRF vectors that let an attacker turn the server into a proxy:
 *   - non-HTTPS schemes (file://, gopher://, http:// to internal services)
 *   - loopback addresses (127.0.0.0/8, ::1)
 *   - RFC 1918 private ranges (10/8, 172.16/12, 192.168/16)
 *   - link-local (169.254/16) — covers AWS/GCP/Azure metadata IPs
 *   - "this network" (0.0.0.0/8)
 *   - ULA + IPv6 link-local (fc00::/7, fe80::/10)
 *
 * KNOWN LIMITATION (TOCTOU): we validate the hostname literal but do NOT
 * resolve it to an IP. A hostname like `evil.example.com` that resolves to
 * 169.254.169.254 will pass this check. Fix later by passing all requests
 * through an egress proxy that re-checks the resolved IP, OR by performing
 * a DNS lookup here and rejecting matches.
 */

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  // IPv4 loopback, RFC1918, link-local, "this network"
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  // IPv6 loopback + link-local + ULA
  /^\[?::1\]?$/,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

export class SsrfBlockedError extends Error {
  constructor(message: string, public readonly url: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Parse and validate an outbound URL. Throws SsrfBlockedError on rejection.
 * Returns the parsed URL on success.
 *
 * @example
 *   const url = assertSafeOutboundUrl(userInput);
 *   await fetch(url.toString(), ...);
 */
export function assertSafeOutboundUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SsrfBlockedError('Invalid URL', raw);
  }

  if (parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(`Only HTTPS is allowed (got ${parsed.protocol})`, raw);
  }

  // Normalise hostname: strip brackets from IPv6 form, lowercase.
  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new SsrfBlockedError('Empty hostname', raw);
  }

  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) {
      throw new SsrfBlockedError(`Hostname not allowed: ${host}`, raw);
    }
  }

  return parsed;
}

/**
 * Boolean variant. Use when you want to short-circuit without exception
 * handling — e.g. when validating a list of URLs and reporting each.
 */
export function isSafeOutboundUrl(raw: string): boolean {
  try {
    assertSafeOutboundUrl(raw);
    return true;
  } catch {
    return false;
  }
}
