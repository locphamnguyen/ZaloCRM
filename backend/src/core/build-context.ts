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
import { config } from '../config/index.js';
import { prisma } from '../shared/database/prisma-client.js';
import { logger } from '../shared/utils/logger.js';
import { loadLicense } from './license-service.js';
import { zaloMessagingImpl } from './zalo-messaging-impl.js';

export interface BuildContextResult {
  ctx: PluginContext;
  /** Cron đã đăng ký — đã start ngay khi register. Giữ list để quản lý/đếm. */
  crons: CronJob[];
}

export function buildContext(app: FastifyInstance, io: SocketServer): BuildContextResult {
  const capabilities = createCapabilityRegistry();
  const policy = createPolicyRegistry();
  const license = loadLicense();
  const crons: CronJob[] = [];

  // Core cung cấp capability gửi tin Zalo (key ổn định cho EE dùng).
  capabilities.provide('zalo.messaging', zaloMessagingImpl);

  const ctx: PluginContext = {
    app,
    io,
    prisma,
    config,
    logger,
    license,
    capabilities,
    policy,
    registerCron: (job) => {
      crons.push(job);
      job.start();
    },
  };

  logger.info(`[plugin-host] edition=${license.edition()}`);
  return { ctx, crons };
}
