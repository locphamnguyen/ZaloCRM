/**
 * facebook-graph-client.ts — Typed wrappers for Facebook Graph API calls.
 * Uses native fetch with AbortController timeout (10s) + 1 retry on 5xx.
 */
import { logger } from '../../../../shared/utils/logger.js';

const GRAPH_BASE = () =>
  `https://graph.facebook.com/${process.env.FB_GRAPH_API_VERSION ?? 'v23.0'}`;

const APP_ID = () => process.env.FB_APP_ID ?? '';
const APP_SECRET = () => process.env.FB_APP_SECRET ?? '';
const TIMEOUT_MS = 10_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface TokenResponse {
  accessToken: string;
  expiresIn: number; // seconds
}

export interface ManagedPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
}

export interface LeadgenForm {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED' | string;
  created_time: string;
}

export interface LeadFieldData {
  name: string;
  values: string[];
}

export interface LeadDetail {
  id: string;
  field_data: LeadFieldData[];
  form_id: string;
  form_name?: string;
  created_time: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  platform?: string;
  is_organic?: boolean;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, init: RequestInit, retries = 1): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (res.status >= 500 && retries > 0) {
      logger.warn('[fb-graph] 5xx from %s, retrying once', url);
      return fetchWithRetry(url, init, retries - 1);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${GRAPH_BASE()}${path}?${qs}`;
  const res = await fetchWithRetry(url, { method: 'GET' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[fb-graph] GET ${path} failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function graphPost<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${GRAPH_BASE()}${path}`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[fb-graph] POST ${path} failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function graphDelete<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${GRAPH_BASE()}${path}?${qs}`;
  const res = await fetchWithRetry(url, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[fb-graph] DELETE ${path} failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Exchange OAuth code for a short-lived user access token.
 */
export async function exchangeCodeForUserToken(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const data = await graphGet<{ access_token: string; expires_in: number; token_type: string }>(
    '/oauth/access_token',
    {
      client_id: APP_ID(),
      client_secret: APP_SECRET(),
      redirect_uri: redirectUri,
      code,
    },
  );
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 0 };
}

/**
 * Exchange short-lived user token for long-lived (60-day) user token.
 */
export async function exchangeUserTokenForLongLived(userToken: string): Promise<TokenResponse> {
  const data = await graphGet<{ access_token: string; expires_in: number; token_type: string }>(
    '/oauth/access_token',
    {
      grant_type: 'fb_exchange_token',
      client_id: APP_ID(),
      client_secret: APP_SECRET(),
      fb_exchange_token: userToken,
    },
  );
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 5_184_000 };
}

/**
 * List pages the user manages. The page tokens returned here are already long-lived
 * (they inherit from the long-lived user token passed in).
 */
export async function getManagedPages(userToken: string): Promise<ManagedPage[]> {
  const data = await graphGet<{ data: ManagedPage[] }>('/me/accounts', {
    access_token: userToken,
    fields: 'id,name,access_token,category',
  });
  return data.data ?? [];
}

/**
 * Subscribe app to page's leadgen webhook events.
 */
export async function subscribePage(pageId: string, pageToken: string): Promise<void> {
  await graphPost<{ success: boolean }>(`/${pageId}/subscribed_apps`, {
    subscribed_fields: 'leadgen',
    access_token: pageToken,
  });
  logger.info('[fb-graph] Subscribed page %s to leadgen', pageId);
}

/**
 * Unsubscribe app from page's leadgen webhook events.
 */
export async function unsubscribePage(pageId: string, pageToken: string): Promise<void> {
  await graphDelete<{ success: boolean }>(`/${pageId}/subscribed_apps`, {
    access_token: pageToken,
  });
  logger.info('[fb-graph] Unsubscribed page %s from leadgen', pageId);
}

/**
 * Fetch all leadgen forms for a page. Paginates until cursor exhausted.
 */
export async function getLeadgenForms(
  pageId: string,
  pageToken: string,
): Promise<LeadgenForm[]> {
  const results: LeadgenForm[] = [];
  let url = `${GRAPH_BASE()}/${pageId}/leadgen_forms?${new URLSearchParams({
    access_token: pageToken,
    fields: 'id,name,status,created_time',
    limit: '100',
  }).toString()}`;

  for (let page = 0; page < 20; page++) {
    const res = await fetchWithRetry(url, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[fb-graph] GET leadgen_forms failed ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      data: LeadgenForm[];
      paging?: { cursors?: { after?: string }; next?: string };
    };
    results.push(...(json.data ?? []));
    if (!json.paging?.next) break;
    url = json.paging.next;
  }

  return results;
}

/**
 * Fetch full lead detail by leadgen_id.
 */
export async function getLeadById(leadgenId: string, pageToken: string): Promise<LeadDetail> {
  return graphGet<LeadDetail>(`/${leadgenId}`, {
    access_token: pageToken,
    fields: 'field_data,form_id,form_name,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform,is_organic',
  });
}
