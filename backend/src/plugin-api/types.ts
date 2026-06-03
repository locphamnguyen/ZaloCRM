/**
 * @zalocrm/plugin-api — Hợp đồng plugin CÔNG KHAI (ổn định, semver).
 *
 * Đây là biên giới ổn định giữa core và các plugin mở rộng.
 * - Core implement các capability/policy và expose qua PluginContext.
 * - Plugin CHỈ được import từ file này (không import backend/src/modules/*).
 *
 * NGUYÊN TẮC VÀNG: core không bao giờ import plugin; plugin chỉ import plugin-api.
 */
import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';

// Lấy chính xác kiểu của các singleton core (type-only import — không tạo coupling runtime).
export type AppConfig = typeof import('../config/index.js').config;
export type AppLogger = typeof import('../shared/utils/logger.js').logger;
export type AppPrisma = typeof import('../shared/database/prisma-client.js').prisma;

/** Cron/background job mà plugin muốn core quản lý tập trung. */
export interface CronJob {
  name: string;
  start(): void;
}

/* ────────────────────────────────────────────────────────────────────────
 * PRIMITIVE 1 — Capability Registry
 * Core "provide" năng lực; EE "get" ra dùng. Internal core đổi tự do,
 * miễn giữ nguyên contract theo key.
 * ──────────────────────────────────────────────────────────────────────── */
export interface CapabilityRegistry {
  /** Core gọi để cung cấp 1 năng lực dưới 1 key ổn định. */
  provide<T>(key: string, impl: T): void;
  /** EE gọi để lấy năng lực. Throw nếu key chưa được provide. */
  get<T>(key: string): T;
  /** Kiểm tra capability có tồn tại không (không throw). */
  has(key: string): boolean;
}

/** Capability gửi tin Zalo — key 'zalo.messaging'. Core implement bằng zaloPool. */
export interface ZaloMessagingCapability {
  sendText(accountId: string, toUid: string, text: string): Promise<void>;
  isConnected(accountId: string): boolean;
}

/** Đích gửi tin nội bộ (nick hệ thống → thread của 1 user). */
export interface InternalContactTarget {
  /** ZaloAccount id của nick hệ thống đang gửi. */
  senderAccountId: string;
  /** UID/thread của user nhận (từ góc nhìn nick gửi). */
  targetUid: string;
}

/**
 * Capability resolve "liên lạc nội bộ" — key 'internal.contact'.
 * Core map user → nick hệ thống + thread (qua SystemNotifyRecipient). Trả null nếu
 * chưa setup / nick chưa connected. Plugin dùng để biết gửi tin nội bộ tới đâu mà
 * không đụng internal system-notify của core.
 */
export interface InternalContactCapability {
  resolve(userId: string, orgId: string): Promise<InternalContactTarget | null>;
}

/* ────────────────────────────────────────────────────────────────────────
 * PRIMITIVE 2 — Policy Registry (guard slot)
 * Core gọi check(name, req) trước khi trả nội dung nhạy cảm.
 * Chưa ai register(name) → check trả TRUE (không khóa). EE register → cổng kiểm tra.
 * ──────────────────────────────────────────────────────────────────────── */
export interface PolicyRequest {
  req: unknown;
  resourceId?: string;
  [key: string]: unknown;
}

export interface PolicyRegistry {
  register(name: string, fn: (r: PolicyRequest) => Promise<boolean>): void;
  /** Trả TRUE nếu chưa có ai register policy này (mặc định cho qua). */
  check(name: string, r: PolicyRequest): Promise<boolean>;
}

/* ────────────────────────────────────────────────────────────────────────
 * PRIMITIVE 3 — Scope Registry (data-scoping slot)
 * Khác policy (boolean gate 1 resource): scope trả 1 WHERE-fragment để LỌC list.
 * Core gọi resolve(name, user, org) rồi merge fragment vào Prisma `where`.
 * Chưa ai register → null (không lọc → community thấy hết). EE register → giới hạn.
 * ──────────────────────────────────────────────────────────────────────── */
/** Mảnh điều kiện Prisma `where` để merge vào query. null = không giới hạn. */
export type ScopeWhere = Record<string, unknown>;

export interface ScopeRegistry {
  register(name: string, fn: (userId: string, orgId: string) => Promise<ScopeWhere | null>): void;
  /** Trả null nếu chưa ai register (mặc định không lọc). */
  resolve(name: string, userId: string, orgId: string): Promise<ScopeWhere | null>;
}

/* ────────────────────────────────────────────────────────────────────────
 * License (chi tiết đầy đủ ở Phase 6 — đây là contract dùng chung).
 * ──────────────────────────────────────────────────────────────────────── */
export interface LicenseService {
  /** Tính năng có được bật không, vd 'chat.ai_suggest'. Community → luôn false. */
  has(feature: string): boolean;
  /** Danh sách feature đang bật (cho frontend). Community → []. */
  features(): string[];
  edition(): 'community' | 'enterprise';
  expiresAt(): Date | null;
  seats(): number | null;
}

/* ────────────────────────────────────────────────────────────────────────
 * PluginContext — tất cả thứ 1 plugin cần. Core dựng, truyền vào register().
 * ──────────────────────────────────────────────────────────────────────── */
export interface PluginContext {
  app: FastifyInstance;
  io: SocketServer;
  prisma: AppPrisma;
  config: AppConfig;
  logger: AppLogger;
  license: LicenseService;
  /** Đăng ký cron — core start + quản lý tập trung (thay startXxxCron() rải rác). */
  registerCron: (job: CronJob) => void;
  capabilities: CapabilityRegistry; // primitive 1
  policy: PolicyRegistry; // primitive 2
  scope: ScopeRegistry; // primitive 3
}

/* ────────────────────────────────────────────────────────────────────────
 * ZaloCrmPlugin — đơn vị tính năng (core hoặc enterprise).
 * ──────────────────────────────────────────────────────────────────────── */
export interface ZaloCrmPlugin {
  name: string;
  version: string;
  edition: 'core' | 'enterprise';
  /** Nếu set, plugin chỉ nạp khi license.has(requiresLicense) === true. */
  requiresLicense?: string;
  register(ctx: PluginContext): Promise<void> | void;
}
