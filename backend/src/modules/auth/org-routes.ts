// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Organization settings routes — get and update current org info.
 * GET is accessible to all authenticated users; PUT requires owner role.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { logger } from '../../shared/utils/logger.js';

// Offset string "+HH:MM" hoặc "-HH:MM" (vd "+07:00"). HH 00-14, MM 00/15/30/45.
const TIMEZONE_REGEX = /^[+-](0\d|1[0-4]):(00|15|30|45)$/;

function normalizeTimezone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!TIMEZONE_REGEX.test(trimmed)) return null;
  return trimmed;
}

// ── Login branding 2026-06-12 — validate 4 trường hiển thị ngoài /login ───────
// logoUrl: path nội bộ "/..." (KHÔNG nhận protocol-relative "//host" — browser sẽ
// resolve ra host ngoài), hoặc https:// (admin tin cậy, gated RBAC settings:edit),
// hoặc http:// CHỈ từ kho media nội bộ (S3_PUBLIC_URL). Chặn http ngoài (mixed-content)
// và mọi scheme khác (javascript:/data:/...). emailDomain dạng tên miền.
const EMAIL_DOMAIN_REGEX = /^(?=.{1,255}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;

type BrandingResult = { value: string | null } | { error: string };

// Chuỗi rỗng → null (cho phép xóa). undefined → bỏ qua (không đụng tới).
function normalizeText(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length === 0 ? null : t.slice(0, maxLen);
}

function normalizeLogoUrl(raw: unknown): BrandingResult {
  if (typeof raw !== 'string') return { error: 'Logo không hợp lệ' };
  const t = raw.trim();
  if (t.length === 0) return { value: null };
  if (t.length > 2048) return { error: 'Đường dẫn logo quá dài' };
  if (t.startsWith('/')) {
    // Chặn protocol-relative "//host" và "/\host" — browser resolve thành host ngoài.
    if (t.startsWith('//') || t.startsWith('/\\')) return { error: 'Đường dẫn logo không hợp lệ' };
    return { value: t }; // path nội bộ (asset tĩnh /brand/...)
  }

  let u: URL;
  try { u = new URL(t); } catch { return { error: 'Logo phải là đường dẫn nội bộ (/...) hoặc URL hợp lệ' }; }
  if (u.protocol === 'https:') return { value: t };
  // http:// chỉ chấp nhận từ máy chủ media nội bộ (MinIO S3_PUBLIC_URL hoặc
  // localhost khi chạy local) — vẫn chặn http ngoài để tránh mixed-content/pixel.
  if (u.protocol === 'http:') {
    const s3 = (process.env.S3_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
    const isStore = s3.length > 0 && t.startsWith(s3 + '/');
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (isStore || isLocal) return { value: t };
    return { error: 'Logo http:// chỉ chấp nhận từ máy chủ media nội bộ' };
  }
  return { error: 'Giao thức logo không hỗ trợ' };
}

function normalizeEmailDomain(raw: unknown): BrandingResult {
  if (typeof raw !== 'string') return { error: 'Tên miền không hợp lệ' };
  const t = raw.trim().toLowerCase();
  if (t.length === 0) return { value: null };
  if (!EMAIL_DOMAIN_REGEX.test(t)) {
    return { error: 'Tên miền không hợp lệ (vd: tenmien.com)' };
  }
  return { value: t };
}

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/organization — get current org info
  app.get('/api/v1/organization', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: {
          id: true, name: true, timezone: true, createdAt: true, updatedAt: true,
          // Login branding 2026-06-12
          logoUrl: true, slogan: true, copyright: true, emailDomain: true,
          // Phase Privacy v2 2026-05-23 — system notify nick (org-wide sender)
          systemNotifyZaloAccountId: true,
          systemNotifyNick: {
            select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true },
          },
        },
      });
      if (!org) return reply.status(404).send({ error: 'Organization not found' });
      return org;
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch organization' });
    }
  });

  // Phase Privacy v2 2026-05-23 — admin pick nick chuyên gửi system notification cho cả org.
  // PATCH /api/v1/organization/system-notify-nick { zaloAccountId: string | null }
  // Admin pick bất kỳ nick org có. Validation: nick exists, in same org. KHÔNG yêu cầu admin own.
  app.patch(
    '/api/v1/organization/system-notify-nick',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body ?? {}) as { zaloAccountId?: string | null };
      const accountId = body.zaloAccountId ?? null;

      if (accountId !== null) {
        // 2026-06-10: archivedAt:null → không cho đặt nick đã xóa mềm làm nick gửi hệ thống.
        const nick = await prisma.zaloAccount.findFirst({
          where: { id: accountId, orgId: user.orgId, archivedAt: null },
          select: { id: true, status: true, displayName: true },
        });
        if (!nick) return reply.status(404).send({ error: 'Nick không tồn tại trong org' });
        // Warning nếu nick disconnected — không block, để admin biết
        if (nick.status !== 'connected') {
          logger.warn(`Org system-notify-nick set to disconnected nick: ${nick.displayName} (${accountId})`);
        }
      }

      await prisma.organization.update({
        where: { id: user.orgId },
        data: { systemNotifyZaloAccountId: accountId },
      });

      return { ok: true, systemNotifyZaloAccountId: accountId };
    },
  );

  // PUT /api/v1/organization — update org info (owner only). name + timezone đều optional,
  // nhưng phải có ít nhất 1 field hợp lệ.
  app.put(
    '/api/v1/organization',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body ?? {}) as {
        name?: string; timezone?: string;
        logoUrl?: string; slogan?: string; copyright?: string; emailDomain?: string;
      };

      const data: {
        name?: string; timezone?: string;
        logoUrl?: string | null; slogan?: string | null;
        copyright?: string | null; emailDomain?: string | null;
      } = {};

      if (body.name !== undefined) {
        const trimmed = String(body.name).trim();
        if (!trimmed) return reply.status(400).send({ error: 'Tên tổ chức là bắt buộc' });
        data.name = trimmed;
      }

      if (body.timezone !== undefined) {
        const tz = normalizeTimezone(body.timezone);
        if (!tz) {
          return reply
            .status(400)
            .send({ error: 'Múi giờ không hợp lệ. Định dạng: +HH:MM hoặc -HH:MM (vd +07:00).' });
        }
        data.timezone = tz;
      }

      // ── Login branding — slogan/copyright tự do (rỗng → xóa); logoUrl/emailDomain validate.
      if (body.slogan !== undefined) data.slogan = normalizeText(body.slogan, 200);
      if (body.copyright !== undefined) data.copyright = normalizeText(body.copyright, 200);

      if (body.logoUrl !== undefined) {
        const r = normalizeLogoUrl(body.logoUrl);
        if ('error' in r) return reply.status(400).send({ error: r.error });
        data.logoUrl = r.value;
      }

      if (body.emailDomain !== undefined) {
        const r = normalizeEmailDomain(body.emailDomain);
        if ('error' in r) return reply.status(400).send({ error: r.error });
        data.emailDomain = r.value;
      }

      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: 'Không có thay đổi nào để lưu' });
      }

      try {
        const org = await prisma.organization.update({
          where: { id: user.orgId },
          data,
          select: {
            id: true, name: true, timezone: true, createdAt: true, updatedAt: true,
            logoUrl: true, slogan: true, copyright: true, emailDomain: true,
          },
        });
        logger.info(
          `Organization updated: ${org.name} (tz=${org.timezone}) by ${user.email}`,
        );
        return org;
      } catch {
        return reply.status(500).send({ error: 'Failed to update organization' });
      }
    },
  );

  // Wave 2 refactor 2026-05-29 — /welcome-config endpoints REMOVED.
  // Welcome template + delay are now per-trigger (see automation_triggers
  // .welcome_message_template / .welcome_delay_seconds). Cross-trigger knobs
  // (welcomeMaxRetries, welcomeStrangerInboxEnabled, welcomeHardFailStops)
  // remain on Organization but are not exposed via this route anymore.

  // ── #3 2026-06-06 (Anh chốt): Cài đặt kỹ thuật automation (admin) ──────────
  // Nhóm tham số VẬN HÀNH nội bộ (nhịp quét, ngưỡng kẹt, timeout...) — trước đây
  // hardcode trong sweepers/worker. Đưa ra trang "Cài đặt kỹ thuật" cho admin.
  // GET cho mọi user xem; PUT chỉ owner/admin. Tất cả số nguyên dương.
  const TECH_FIELDS = [
    'autoStuckSweepSeconds', 'autoDrainerSweepSeconds', 'autoWelcomeProbeSeconds',
    'autoRemindSweepMinutes', 'autoStuckThresholdMinutes', 'autoStuckMaxRecovery',
    'autoCampaignTimeoutHours', 'autoNickOfflineResetHours',
  ] as const;
  // Range guard mỗi field (min, max) — chặn giá trị vô lý gây treo hệ thống.
  const TECH_RANGES: Record<(typeof TECH_FIELDS)[number], [number, number]> = {
    autoStuckSweepSeconds: [10, 3600],
    autoDrainerSweepSeconds: [5, 3600],
    autoWelcomeProbeSeconds: [5, 3600],
    autoRemindSweepMinutes: [1, 1440],
    autoStuckThresholdMinutes: [1, 1440],
    autoStuckMaxRecovery: [1, 1000],
    autoCampaignTimeoutHours: [1, 720],
    autoNickOfflineResetHours: [1, 720],
  };

  const techSelect = Object.fromEntries(TECH_FIELDS.map((f) => [f, true]));

  // GET /api/v1/organization/automation-settings
  app.get('/api/v1/organization/automation-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const org = await prisma.organization.findUnique({
      where: { id: user.orgId },
      select: techSelect,
    });
    if (!org) return reply.status(404).send({ error: 'Organization not found' });
    return org;
  });

  // PUT /api/v1/organization/automation-settings — owner/admin only
  app.put(
    '/api/v1/organization/automation-settings',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const data: Record<string, number> = {};
      for (const field of TECH_FIELDS) {
        if (body[field] === undefined) continue;
        const v = Number(body[field]);
        const [min, max] = TECH_RANGES[field];
        if (!Number.isFinite(v) || v < min || v > max) {
          return reply.status(400).send({ error: `${field}_invalid`, hint: `Phải từ ${min} đến ${max}` });
        }
        data[field] = Math.round(v);
      }
      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: 'no_fields', hint: 'Không có tham số hợp lệ để cập nhật' });
      }
      const org = await prisma.organization.update({
        where: { id: user.orgId },
        data,
        select: techSelect,
      });
      logger.info(`[org] automation-settings updated by ${user.email}: ${Object.keys(data).join(',')}`);
      return { ok: true, settings: org };
    },
  );
}
