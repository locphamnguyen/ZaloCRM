// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Prisma client singleton.
 * Prisma 7 requires an adapter for database connection.
 * Reuses the same client instance across hot-reloads in development.
 *
 * Extension: Contact write paths AUTO-derive `phoneNormalized` từ `phone` qua
 * normalizePhone() — đảm bảo mọi nguồn (CRM UI, import CSV, Zalo sync, automation,
 * webhook ...) đều có canonical phone, dedup chính xác cross-format. KHÔNG cần
 * 16 call sites tự nhớ set phoneNormalized.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizePhone } from '../utils/phone.js';
import { checkTenantGuard } from '../tenant/tenant-guard.js';
import { getTenantContext, runWithRlsApplied } from '../tenant/tenant-context.js';
import { config } from '../../config/index.js';

// $extends() returns a structurally-different type — alias to host extended client.
type ExtendedPrisma = ReturnType<typeof createPrismaClient>;
const globalForPrisma = globalThis as unknown as { prisma: ExtendedPrisma };

function deriveContactPhoneNormalized<T extends Record<string, unknown>>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  // Chỉ động chạm khi caller pass `phone` (kể cả null để clear). Không pass phone
  // → giữ phoneNormalized hiện tại (no-op).
  if (!('phone' in data)) return data;
  const phoneVal = data.phone as string | null | undefined;
  return { ...data, phoneNormalized: normalizePhone(phoneVal) };
}

/**
 * Lọc NULL byte (\u0000) khỏi mọi chuỗi trong write payload.
 * 2026-06-09: khách Zalo gửi tin chứa 0x00 → Postgres ném "invalid byte sequence
 * for encoding UTF8: 0x00" → tin MẤT khỏi CRM. Postgres TEXT không lưu được 0x00.
 * Áp ở tầng client (mọi model, mọi write) để không sót call site nào.
 * Đệ quy qua object/array; giữ nguyên Date/Buffer (chỉ chạm string thuần).
 */
function stripNullBytes<T>(value: T, depth = 0): T {
  if (depth > 8) return value; // chặn đệ quy sâu bất thường
  if (typeof value === 'string') {
    return (value.includes('\u0000') ? value.replace(/\u0000/g, '') : value) as T;
  }
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripNullBytes(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = stripNullBytes(v, depth + 1);
  }
  return out as T;
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const adapter = new PrismaPg({ connectionString });

  const base = new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

  return base.$extends({
    // Lưới chặn NULL byte cho MỌI model + MỌI thao tác ghi. Chạy trước extension khác.
    name: 'strip-null-bytes',
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const a = args as Record<string, unknown>;
          if (a && typeof a === 'object') {
            if ('data' in a) a.data = stripNullBytes(a.data);
            if ('create' in a) a.create = stripNullBytes(a.create);
            if ('update' in a) a.update = stripNullBytes(a.update);
          }
          return query(args);
        },
      },
    },
  }).$extends({
    name: 'contact-phone-normalize',
    query: {
      contact: {
        async create({ args, query }) {
          args.data = deriveContactPhoneNormalized(args.data as Record<string, unknown>) as typeof args.data;
          return query(args);
        },
        async update({ args, query }) {
          args.data = deriveContactPhoneNormalized(args.data as Record<string, unknown>) as typeof args.data;
          return query(args);
        },
        async updateMany({ args, query }) {
          args.data = deriveContactPhoneNormalized(args.data as Record<string, unknown>) as typeof args.data;
          return query(args);
        },
        async upsert({ args, query }) {
          args.create = deriveContactPhoneNormalized(args.create as Record<string, unknown>) as typeof args.create;
          args.update = deriveContactPhoneNormalized(args.update as Record<string, unknown>) as typeof args.update;
          return query(args);
        },
      },
    },
  }).$extends({
    // Phase 1a tenant-guard 2026-06-07 — defense-in-depth tầng app.
    // Mặc định OFF (config.tenantGuardMode) → no-op, zero risk khi deploy.
    // Biên giới CHÍNH là Postgres RLS (migration riêng).
    name: 'tenant-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          checkTenantGuard(model, operation);
          return query(args);
        },
      },
    },
  }).$extends({
    // Phase 1a RLS connection-binding 2026-06-09 (Giai đoạn 0).
    // Gắn `app.current_org` (hoặc `app.bypass_rls`) vào connection để Postgres RLS đọc
    // được tenant. Gated bởi config.rlsSetConfig — mặc định OFF → return query thẳng,
    // ZERO overhead/đổi hành vi. Khi ON: wrap mỗi op auto-commit trong $transaction
    // dạng MẢNG [setConfig, query] → cả 2 chạy CÙNG 1 connection/transaction (SET LOCAL
    // mới có hiệu lực). Bỏ qua khi đã ở trong tenantTransaction (rlsConfigApplied) để
    // tránh LỒNG transaction. Query ngoài mọi context (ctx undefined) → không set →
    // RLS sẽ chặn (fail-safe; warn-mode/tenant-guard bắt các chỗ này trước).
    name: 'tenant-rls-setconfig',
    query: {
      $allModels: {
        async $allOperations({ args, query }): Promise<unknown> {
          if (!config.rlsSetConfig) return query(args);
          const ctx = getTenantContext();
          if (!ctx || ctx.rlsConfigApplied) return query(args);
          // Dùng `base` (PrismaClient cụ thể, chưa $extends) cho raw + transaction để
          // tránh vòng lặp type khi tham chiếu client đã-extend trong chính định nghĩa nó.
          const setStmt =
            ctx.bypassTenantGuard || ctx.orgId === '*'
              ? base.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`
              : base.$executeRaw`SELECT set_config('app.current_org', ${ctx.orgId}, true)`;
          const [, result] = await base.$transaction([setStmt, query(args)]);
          return result;
        },
      },
    },
  });
}

/**
 * tenantTransaction — interactive transaction CÓ gắn tenant cho RLS (Giai đoạn 0).
 *
 * Thay cho `prisma.$transaction(async (tx) => ...)` ở MỌI call-site org-scoped: set
 * `app.current_org`/`app.bypass_rls` MỘT LẦN trên connection của tx (SET LOCAL), rồi
 * chạy callback với `tx`. Đánh dấu rlsConfigApplied=true để op bên trong KHÔNG bị
 * RLS-setconfig extension wrap lồng transaction.
 *
 * Khi config.rlsSetConfig=OFF → hành xử y hệt prisma.$transaction (không set gì).
 */
export function tenantTransaction<T>(
  fn: (tx: TxClient) => Promise<T>,
  opts?: { maxWait?: number; timeout?: number; isolationLevel?: unknown },
): Promise<T> {
  const ctx = getTenantContext();
  return (prisma.$transaction as any)(async (tx: TxClient) => {
    if (config.rlsSetConfig && ctx) {
      if (ctx.bypassTenantGuard || ctx.orgId === '*') {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      } else {
        await tx.$executeRaw`SELECT set_config('app.current_org', ${ctx.orgId}, true)`;
      }
    }
    return runWithRlsApplied(() => fn(tx));
  }, opts);
}

// Transaction client trong callback $transaction của client ĐÃ-extend — giữ nguyên type
// như `prisma.$transaction(async (tx) => ...)` để call-site không mất type của tx.x.*.
// Extract overload dạng-callback rồi lấy param đầu (tx). Ở ngoài createPrismaClient nên
// không gây vòng lặp type.
type InteractiveTxFn = Extract<Parameters<typeof prisma.$transaction>[0], (...a: never[]) => unknown>;
type TxClient = Parameters<InteractiveTxFn>[0];

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// (XÓA 2026-06-12) AutomationTask monkey-patch stub — model đã DROP (migration
// 20260601182155_marketing_bullmq_rebuild), runtime giờ là BullMQ. Mọi caller
// `prisma.automationTask.*` đã được dọn sạch (grep-gate = 0). Giữ patch nữa chỉ
// che lỗi: nếu code mới lỡ gọi prisma.automationTask, giờ nó sẽ undefined → crash
// rõ ràng lúc dev thay vì nuốt im (đúng ý: để lỗi tự lộ).
