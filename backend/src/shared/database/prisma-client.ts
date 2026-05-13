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
  });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
