/**
 * buildContext — dựng PluginContext từ các singleton core.
 *
 * Đây là chỗ core "nối dây": tạo 2 registry, provide capability core sẵn có,
 * gom cron. Mọi plugin (core + EE) nhận đúng 1 context này.
 */
import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import type { CronJob, PluginContext } from '../plugin-api/index.js';
import { createCapabilityRegistry } from '../plugin-api/index.js';
import { createPolicyRegistry } from '../plugin-api/index.js';
import { createScopeRegistry } from '../plugin-api/index.js';
import type { ScopeRegistry } from '../plugin-api/index.js';

// app.scope: core route gọi để lấy WHERE-fragment lọc list (EE đăng ký, community = null).
declare module 'fastify' {
  interface FastifyInstance {
    scope: ScopeRegistry;
  }
}
import { config } from '../config/index.js';
import { prisma } from '../shared/database/prisma-client.js';
import { logger } from '../shared/utils/logger.js';
import { loadLicense } from './license-service.js';
import { zaloMessagingImpl } from './zalo-messaging-impl.js';
import { internalContactImpl } from './internal-contact-impl.js';

export interface BuildContextResult {
  ctx: PluginContext;
  /** Cron đã đăng ký — đã start ngay khi register. Giữ list để quản lý/đếm. */
  crons: CronJob[];
}

export function buildContext(app: FastifyInstance, io: SocketServer): BuildContextResult {
  const capabilities = createCapabilityRegistry();
  const policy = createPolicyRegistry();
  const scope = createScopeRegistry();
  const license = loadLicense();
  const crons: CronJob[] = [];

  // Decorate app → route core (đăng ký sau loadPlugins) gọi được app.scope.resolve(...).
  app.decorate('scope', scope);

  // Core cung cấp capability gửi tin Zalo (key ổn định cho EE dùng).
  capabilities.provide('zalo.messaging', zaloMessagingImpl);
  // Core resolve "liên lạc nội bộ" của user (nick hệ thống + thread) cho plugin gửi tin nội bộ.
  capabilities.provide('internal.contact', internalContactImpl);

  const ctx: PluginContext = {
    app,
    io,
    prisma,
    config,
    logger,
    license,
    capabilities,
    policy,
    scope,
    registerCron: (job) => {
      crons.push(job);
      job.start();
    },
  };

  logger.info(`[plugin-host] edition=${license.edition()}`);
  return { ctx, crons };
}
