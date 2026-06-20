// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Open-core seam — integrations.
 *
 * The generic sync-engine (core) supports several integration providers. The
 * Facebook provider is an extension feature, so core must not import it
 * directly. Core calls `importFacebookLeads()` from here; it defaults to a
 * disabled no-op and the extension bundle installs the real implementation via
 * `registerFacebookLeadsImporter()` at boot (see backend/src/_ee).
 *
 * This file lives in core and is identical across editions.
 */

export interface SyncResult {
  direction: 'import' | 'export';
  recordCount: number;
  status: 'success' | 'partial' | 'failed';
  errorMessage?: string;
}

export type FacebookLeadsImporter = (
  orgId: string,
  cfg: Record<string, unknown>,
) => Promise<SyncResult>;

const disabledImporter: FacebookLeadsImporter = async () => ({
  direction: 'import',
  recordCount: 0,
  status: 'failed',
  errorMessage: 'Facebook integration is not available in this edition',
});

let _importFacebookLeads: FacebookLeadsImporter = disabledImporter;

export const importFacebookLeads: FacebookLeadsImporter = (orgId, cfg) =>
  _importFacebookLeads(orgId, cfg);

export function registerFacebookLeadsImporter(fn: FacebookLeadsImporter): void {
  _importFacebookLeads = fn;
}
