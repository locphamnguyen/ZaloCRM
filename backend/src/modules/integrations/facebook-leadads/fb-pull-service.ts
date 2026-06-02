/**
 * fb-pull-service.ts — Kéo lead Facebook chủ động bằng System User token (chính chủ).
 *
 * KHÁC webhook (push): không cần App Review, không cần gắn app vào Page. Dùng System
 * User token (vĩnh viễn, quyền leads_retrieval) → đổi sang Page token mỗi tick → list
 * leadgen_forms → kéo lead từ /{formId}/leads (có sẵn campaign_name per lead) → route
 * qua #KEY → tạo CustomerListEntry. Tái dùng resolveListFromCampaign + normalizePhone.
 *
 * Checkpoint: watermark lastPulledLeadCreatedTime (bền vững hơn Graph cursor). Lần đầu
 * mỗi form historyBackfilled=false → kéo TOÀN BỘ lead lịch sử (anh chốt 2026-05-30).
 *
 * Bắt buộc theo memory: hasZalo=null (KHÔNG tự quét Zalo), timestamp UTC trong DB.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { normalizePhone } from '../../../shared/utils/phone.js';
import { decryptToken } from '../_shared/token-encryption.util.js';
import { resolveListFromCampaign } from '../_shared/lead-routing.service.js';
import { checkAndIncrementNotify } from '../_shared/notify-dedup.service.js';

const GRAPH_API_VERSION = 'v19.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const PAGE_SIZE = 100; // lead/trang khi pull
const MAX_PAGES_PER_FORM_PER_TICK = 50; // chặn 1 form độc chiếm 1 tick (50×100=5000 lead/tick/form)
const DISABLE_AFTER_CONSECUTIVE_ERRORS = 10;

// Gom các notify-key Unrouted trong 1 tick → flush 1 lần ở cuối (tránh đụng unique
// constraint khi nhiều lead Unrouted insert song song cùng gọi checkAndIncrementNotify).
const pendingUnroutedNotify = new Set<string>();

interface FbLead {
  id: string;
  created_time: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  form_id?: string;
  platform?: string;
  is_organic?: boolean;
  field_data?: Array<{ name?: string; values?: string[] }>;
}

/** Đổi System User token → Page token (Page token kế thừa quyền leads_retrieval). */
async function getPageToken(pageId: string, suToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(suToken)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      const txt = await res.text();
      logger.warn(`[fb-pull] getPageToken page=${pageId} ${res.status}: ${txt.slice(0, 160)}`);
      return null;
    }
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch (err) {
    logger.warn(`[fb-pull] getPageToken page=${pageId} fetch fail: ${(err as Error).message}`);
    return null;
  }
}

/** List leadgen_forms của Page → upsert registry. */
async function syncForms(orgId: string, pageId: string, pageToken: string): Promise<void> {
  let url: string | null =
    `${GRAPH}/${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name,status&limit=100&access_token=${encodeURIComponent(pageToken)}`;
  const seenFormIds: string[] = [];

  while (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const txt = await res.text();
      logger.warn(`[fb-pull] syncForms page=${pageId} ${res.status}: ${txt.slice(0, 160)}`);
      return;
    }
    const data = (await res.json()) as {
      data?: Array<{ id?: string; name?: string; status?: string }>;
      paging?: { next?: string };
    };
    for (const f of data.data ?? []) {
      if (!f.id) continue;
      seenFormIds.push(f.id);
      const status = f.status === 'ARCHIVED' ? 'archived' : 'active';
      await prisma.facebookLeadgenForm.upsert({
        where: { pageId_formId: { pageId, formId: f.id } },
        create: { orgId, pageId, formId: f.id, formName: f.name ?? null, status },
        update: { formName: f.name ?? undefined, status },
      });
    }
    url = data.paging?.next ?? null;
  }

  // Form biến mất khỏi list FB → mark deleted (giữ lịch sử checkpoint).
  if (seenFormIds.length > 0) {
    await prisma.facebookLeadgenForm.updateMany({
      where: { pageId, formId: { notIn: seenFormIds }, status: { not: 'deleted' } },
      data: { status: 'deleted' },
    });
  }
}

/**
 * Lấy TÊN thật trên Facebook của khách từ inbox_url (chứa PSID).
 * Đường: GET /{pageId}/conversations?user_id={psid} → participant.name.
 * Meta KHÔNG cho ảnh / link profile — chỉ tên. Cần quyền pages_messaging.
 * Lỗi/không có inbox → trả null (không chặn pull).
 */
async function resolveFbProfileName(
  pageId: string,
  pageToken: string,
  inboxUrl: string | undefined,
): Promise<string | null> {
  if (!inboxUrl) return null;
  const m = inboxUrl.match(/latest\/(\d+)/);
  const psid = m?.[1];
  if (!psid) return null;
  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(pageId)}/conversations?user_id=${encodeURIComponent(psid)}&fields=participants{id,name}&access_token=${encodeURIComponent(pageToken)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ participants?: { data?: Array<{ id?: string; name?: string }> } }>;
    };
    const parts = data.data?.[0]?.participants?.data ?? [];
    const customer = parts.find((p) => p.id && p.id !== pageId);
    return customer?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract name/phone/customFields từ field_data. Form lead VN dùng tên field tiếng Việt
 * ("Số điện thoại", "Tên đầy đủ") thay vì FB built-in name (phone_number/full_name) →
 * phải nhận diện cả 2. Fallback cuối: field nào value trông giống SĐT (regex) thì coi là phone.
 */
function isPhoneField(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === 'phone_number' || n === 'phone' ||
    n.includes('điện thoại') || n.includes('dien thoai') ||
    n.includes('sđt') || n.includes('sdt') || n.includes('số đt') ||
    n.includes('phone') || n.includes('mobile') || n.includes('số liên hệ')
  );
}
function isNameField(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === 'full_name' || n === 'name' ||
    n.includes('họ tên') || n.includes('ho ten') ||
    n.includes('tên đầy đủ') || n.includes('ten day du') ||
    (n.includes('tên') && !n.includes('quan tâm')) || n.includes('họ và tên')
  );
}
/** Value trông giống SĐT VN: 9-12 chữ số (cho phép +, khoảng trắng, dấu chấm). */
function looksLikePhone(val: string): boolean {
  const digits = val.replace(/[^\d]/g, '');
  return digits.length >= 9 && digits.length <= 12 && /^[\d+\s.\-()]+$/.test(val.trim());
}

function extractFields(fieldData: Array<{ name?: string; values?: string[] }>): {
  name: string;
  phone: string;
  customFields: Record<string, unknown>;
} {
  let name = '';
  let phone = '';
  const customFields: Record<string, unknown> = {};
  for (const f of fieldData) {
    const fname = (f.name ?? '').trim();
    const val = (f.values?.[0] ?? '').trim();
    if (!fname) continue;
    if (!phone && isPhoneField(fname)) phone = val;
    else if (!name && isNameField(fname)) name = val;
    else customFields[fname] = val;
  }
  // Fallback: chưa bắt được phone qua tên field → quét value giống SĐT trong customFields
  if (!phone) {
    for (const [k, v] of Object.entries(customFields)) {
      if (typeof v === 'string' && looksLikePhone(v)) {
        phone = v;
        delete customFields[k];
        break;
      }
    }
  }
  return { name, phone, customFields };
}

/** Tạo CustomerListEntry idempotent cho 1 lead. Trả true nếu insert mới. */
async function ingestLead(
  orgId: string,
  lead: FbLead,
  formName: string | null,
  pageId: string,
  pageToken: string,
): Promise<boolean> {
  const fieldData = lead.field_data ?? [];
  const { name, phone, customFields } = extractFields(fieldData);
  if (!phone) {
    logger.debug(`[fb-pull] lead ${lead.id} thiếu phone — skip`);
    return false;
  }

  const campaignId = lead.campaign_id ?? '';
  const campaignName = lead.campaign_name ?? '';
  // Route qua #KEY — tái dùng 100% webhook path. campaignName rỗng → tự về Unrouted.
  const routing = await resolveListFromCampaign(orgId, campaignId || `nocampaign:${lead.form_id ?? lead.id}`, campaignName);

  // Idempotency: lead đã pull vào list này chưa (theo sourceMeta.externalLeadId).
  const existing = await prisma.customerListEntry.findFirst({
    where: {
      customerListId: routing.listId,
      sourceMeta: { path: ['externalLeadId'], equals: lead.id },
    },
    select: { id: true },
  });
  if (existing) return false;

  const phoneNormalized = normalizePhone(phone);
  const phoneE164 = phoneNormalized ? `+${phoneNormalized}` : null;
  const phoneLocal = phoneNormalized && phoneNormalized.startsWith('84') ? `0${phoneNormalized.slice(2)}` : phoneNormalized;
  const phoneValid = !!phoneNormalized;

  // Tên thật Facebook của khách (từ inbox) — chỉ gọi cho lead MỚI (sau idempotency).
  const inboxUrl = (customFields.inbox_url ?? (fieldData.find((f) => f.name === 'inbox_url')?.values?.[0])) as string | undefined;
  const fbProfileName = await resolveFbProfileName(pageId, pageToken, inboxUrl);

  const sourceMeta = {
    source: 'fb-leadads',
    externalLeadId: lead.id,
    campaignId,
    campaignName,
    adsetId: lead.adset_id ?? null,
    adsetName: lead.adset_name ?? null,
    adId: lead.ad_id ?? null,
    adName: lead.ad_name ?? null,
    formId: lead.form_id ?? null,
    formName: formName ?? null,
    platform: lead.platform ?? null,
    isOrganic: lead.is_organic ?? null,
    fbProfileName: fbProfileName ?? null, // tên thật trên Facebook (≠ tên khách tự điền form)
    pulledVia: 'system_user_pull',
    submittedAt: lead.created_time ? Date.parse(lead.created_time) : null,
    rawFieldData: fieldData,
  };

  // rowIndex batch-safe: count+1, retry nếu đụng unique (nhiều lead cùng list trong 1 tick).
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await prisma.customerListEntry.count({ where: { customerListId: routing.listId } });
    try {
      await prisma.customerListEntry.create({
        data: {
          customerListId: routing.listId,
          rowIndex: count + 1,
          phoneRaw: phone,
          nameRaw: name || null,
          phoneE164,
          phoneLocal,
          phoneValid,
          invalidReason: phoneValid ? null : 'invalid_format',
          customFields: customFields as object,
          sourceMeta: sourceMeta as object,
          status: phoneValid ? 'validated' : 'invalid',
          hasZalo: null, // KHÔNG tự quét Zalo (memory M52) — enrichment worker xử lý sau
        },
      });
      // Notify Unrouted để dành cho cuối tick (tránh đụng unique notify_key khi
      // nhiều lead Unrouted insert song song trong cùng tick). Xem flushUnroutedNotify.
      if (routing.isUnrouted) {
        pendingUnroutedNotify.add(`unrouted:pull:${campaignId || lead.form_id || 'nocamp'}`);
      }
      return true;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('rowIndex') || msg.includes('Unique') || msg.includes('unique')) continue; // retry rowIndex mới
      throw err;
    }
  }
  logger.warn(`[fb-pull] lead ${lead.id} không tạo được entry sau 5 lần retry rowIndex`);
  return false;
}

/** Kéo lead 1 form (phân trang + checkpoint watermark). */
async function pullFormLeads(form: {
  id: string;
  orgId: string;
  formId: string;
  formName: string | null;
  historyBackfilled: boolean;
  lastPulledLeadCreatedTime: Date | null;
  consecutiveErrors: number;
}, pageToken: string, pageId: string): Promise<void> {
  // Backfill lần đầu: KHÔNG filter time → kéo toàn bộ lịch sử (anh chốt). Sau đó incremental.
  const useWatermark = form.historyBackfilled && form.lastPulledLeadCreatedTime;
  const fields = 'id,created_time,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,form_id,platform,is_organic,field_data';
  let url: string | null;
  if (useWatermark) {
    const epoch = Math.floor(form.lastPulledLeadCreatedTime!.getTime() / 1000);
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: epoch }]));
    url = `${GRAPH}/${encodeURIComponent(form.formId)}/leads?fields=${fields}&filtering=${filtering}&limit=${PAGE_SIZE}&access_token=${encodeURIComponent(pageToken)}`;
  } else {
    url = `${GRAPH}/${encodeURIComponent(form.formId)}/leads?fields=${fields}&limit=${PAGE_SIZE}&access_token=${encodeURIComponent(pageToken)}`;
  }

  let inserted = 0;
  let maxCreated = form.lastPulledLeadCreatedTime?.getTime() ?? 0;
  let pages = 0;

  try {
    while (url && pages < MAX_PAGES_PER_FORM_PER_TICK) {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        const txt = await res.text();
        // Rate limit (code 4/17/32) → dừng êm, tick sau retry, KHÔNG tính lỗi auth
        if (res.status === 429 || /\b(#4|#17|#32|rate limit|reduce the amount)\b/i.test(txt)) {
          logger.info(`[fb-pull] form ${form.formId} rate-limited — dừng, tick sau retry`);
          return;
        }
        throw new Error(`Graph /leads ${res.status}: ${txt.slice(0, 200)}`);
      }
      const data = (await res.json()) as { data?: FbLead[]; paging?: { next?: string } };
      for (const lead of data.data ?? []) {
        const ok = await ingestLead(form.orgId, lead, form.formName, pageId, pageToken);
        if (ok) inserted++;
        const ct = lead.created_time ? Date.parse(lead.created_time) : 0;
        if (ct > maxCreated) maxCreated = ct;
      }
      url = data.paging?.next ?? null;
      pages++;
    }

    await prisma.facebookLeadgenForm.update({
      where: { id: form.id },
      data: {
        lastPulledLeadCreatedTime: maxCreated > 0 ? new Date(maxCreated) : form.lastPulledLeadCreatedTime,
        lastPullAt: new Date(),
        lastPullLeadCount: inserted,
        lastPullError: null,
        consecutiveErrors: 0,
        historyBackfilled: true, // đã backfill xong (kể cả khi 0 lead) → tick sau chỉ incremental
      },
    });
    if (inserted > 0) {
      logger.info(`[fb-pull] form "${form.formName ?? form.formId}" → +${inserted} lead mới`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await prisma.facebookLeadgenForm.update({
      where: { id: form.id },
      data: {
        lastPullAt: new Date(),
        lastPullError: msg.slice(0, 500),
        consecutiveErrors: { increment: 1 },
        // Quá ngưỡng lỗi liên tiếp → đánh dấu archived để ngừng quấy (admin xem lastPullError)
        status: form.consecutiveErrors + 1 >= DISABLE_AFTER_CONSECUTIVE_ERRORS ? 'archived' : undefined,
      },
    });
    logger.warn(`[fb-pull] form ${form.formId} lỗi: ${msg.slice(0, 160)}`);
  }
}

/** 1 lần quét toàn bộ: mỗi Org bật pull → mỗi Page → sync forms → pull mỗi form. */
export async function runFbPullTick(): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { fbPullEnabled: true, encryptedFbSystemUserToken: { not: null } },
    select: { id: true, encryptedFbSystemUserToken: true },
  });
  if (orgs.length === 0) return;
  pendingUnroutedNotify.clear(); // reset đầu mỗi tick (biến module-level)

  for (const org of orgs) {
    let suToken: string;
    try {
      suToken = decryptToken(org.encryptedFbSystemUserToken!);
    } catch (err) {
      logger.error(`[fb-pull] org ${org.id} decrypt SU token fail: ${(err as Error).message}`);
      continue;
    }

    const pages = await prisma.facebookPageAccount.findMany({
      where: { orgId: org.id, isActive: true },
      select: { pageId: true },
    });

    for (const page of pages) {
      const pageToken = await getPageToken(page.pageId, suToken);
      if (!pageToken) continue; // lỗi token tạm thời → tick sau

      await syncForms(org.id, page.pageId, pageToken);

      const forms = await prisma.facebookLeadgenForm.findMany({
        where: { orgId: org.id, pageId: page.pageId, status: 'active' },
        select: {
          id: true, orgId: true, formId: true, formName: true,
          historyBackfilled: true, lastPulledLeadCreatedTime: true, consecutiveErrors: true,
        },
      });
      for (const form of forms) {
        await pullFormLeads(form, pageToken, page.pageId);
      }
    }

    // Flush Unrouted notify 1 lần/key sau khi pull xong toàn org (tuần tự, không đụng unique).
    // Notify chỉ là phụ — bọc try/catch nuốt lỗi để KHÔNG bao giờ làm hỏng pull.
    for (const key of pendingUnroutedNotify) {
      try { await checkAndIncrementNotify(org.id, key); } catch { /* notify phụ, bỏ qua */ }
    }
    pendingUnroutedNotify.clear();
  }
}
