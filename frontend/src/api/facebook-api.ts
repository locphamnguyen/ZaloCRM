/**
 * facebook-api.ts — Axios wrappers for Facebook integration endpoints.
 * All paths relative to /api/v1 (baseURL set in api/index.ts).
 *
 * FB-11: Manual mapping removed. Discovery is auto on OAuth callback.
 */
import { api } from '@/api/index';

const FB = '/integrations/facebook';

// ── DTO types ────────────────────────────────────────────────────────────────

export interface FacebookPageConnectionDto {
  id: string;
  pageId: string;
  pageName: string;
  status: 'connected' | 'revoked' | 'error';
  subscribedAt: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  lastLeadAt: string | null;
}

export interface FacebookFormMappingDto {
  id: string;
  orgId: string;
  pageConnectionId: string;
  formId: string;
  formName: string;
  customerListId: string;
  fieldMap: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  customerListName: string | null;
  leadCount: number;
  lastLeadAt: string | null;
  pageConnection: {
    pageId: string;
    pageName: string;
    status: string;
  };
  customerList: {
    id: string;
    name: string;
    iconEmoji: string | null;
  } | null;
}

export interface TokenRefreshSummary {
  checked: number;
  refreshed: number;
  errors: number;
}

// ── API functions ─────────────────────────────────────────────────────────────

/** Begin OAuth flow — POST with auth header, get Meta dialog URL, then redirect browser. */
export async function startFbOAuth(): Promise<string> {
  const { data } = await api.post<{ url: string }>(`${FB}/oauth/start`);
  return data.url;
}

/** List connected Facebook pages for current org. */
export async function listPages(): Promise<FacebookPageConnectionDto[]> {
  const { data } = await api.get<FacebookPageConnectionDto[]>(`${FB}/pages`);
  return data;
}

/** Disconnect a page. Returns count of mappings that were disabled. */
export async function disconnectPage(
  pageId: string,
): Promise<{ success: boolean; disabledMappings: number }> {
  const { data } = await api.post<{ success: boolean; disabledMappings: number }>(
    `${FB}/pages/${pageId}/disconnect`,
  );
  return data;
}

/** List all form mappings for current org (auto-discovered, read-only). */
export async function listMappings(): Promise<FacebookFormMappingDto[]> {
  const { data } = await api.get<FacebookFormMappingDto[]>(`${FB}/mappings`);
  return data;
}

/**
 * Manually trigger form re-discovery for a connected page.
 * Returns jobId (may be null if Redis unavailable).
 */
export async function rediscoverPage(pageId: string): Promise<{ jobId: string | null }> {
  const { data } = await api.post<{ jobId: string | null }>(`${FB}/pages/${pageId}/rediscover`);
  return data;
}

/** Manual trigger: refresh tokens for all connected pages in current org. */
export async function adminRefreshTokens(): Promise<TokenRefreshSummary> {
  const { data } = await api.post<TokenRefreshSummary>(`${FB}/admin/refresh-tokens`);
  return data;
}
