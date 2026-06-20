// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * profile-routes.ts — REST API for Zalo account profile management.
 * Ports openzca `me` commands: info, last-online, avatar, status, update, avatars CRUD.
 * All routes scoped to /api/v1/zalo-accounts/:accountId/profile and require JWT auth.
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { resolveAccount, checkAccess, handleError } from './zalo-route-helpers.js';
import { updateProfile, listAvatars, deleteAvatar, reuseAvatar } from './profile-operations.js';
import type { Gender } from './profile-operations.js';

const BASE = '/api/v1/zalo-accounts/:accountId/profile';

export async function profileRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET .../profile — get Zalo account info
  app.get(BASE, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const { orgId } = request.user!;
    try {
      await resolveAccount(accountId, orgId);
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      const result = await zaloOps.getAccountInfo(accountId);
      return { profile: result };
    } catch (err) {
      return handleError(reply, err, 'getAccountInfo');
    }
  });

  // PATCH .../profile — update name / gender / birthday
  app.patch<{ Params: { accountId: string }; Body: { name?: string; gender?: 0 | 1; dob?: string } }>(
    BASE,
    async (request, reply) => {
      const { accountId } = request.params;
      const { name, gender, dob } = request.body ?? {};
      const { orgId } = request.user!;
      try {
        await resolveAccount(accountId, orgId);
        if (!await checkAccess(request, reply, accountId, 'admin')) return;
        const result = await updateProfile(accountId, { name, gender: gender as Gender | undefined, dob });
        return result;
      } catch (err) {
        return handleError(reply, err, 'updateProfile');
      }
    },
  );

  // GET .../profile/last-online/:userId — get REAL last online via Zalo SDK
  // với cache layer 30s + privacy gate (show_online_status). Trả format flat
  // cho FE: { lastOnline: number|null, showStatus: bool, isOnline: bool, fetchedAt }
  app.get(`${BASE}/last-online/:userId`, async (request, reply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const { orgId } = request.user!;
    try {
      await resolveAccount(accountId, orgId);
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      const { getPresence } = await import('./presence-service.js');
      const entry = await getPresence(accountId, userId);
      if (!entry) {
        return { lastOnline: null, showStatus: false, isOnline: false, fetchedAt: Date.now() };
      }
      const isOnline = entry.lastOnline !== null && Date.now() - entry.lastOnline < 5 * 60_000;
      return {
        lastOnline: entry.lastOnline,
        showStatus: entry.showStatus,
        isOnline,
        fetchedAt: entry.fetchedAt,
      };
    } catch (err) {
      return handleError(reply, err, 'getLastOnline');
    }
  });

  // GET .../profile/avatars — list all avatars
  app.get(`${BASE}/avatars`, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const { orgId } = request.user!;
    try {
      await resolveAccount(accountId, orgId);
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      const avatars = await listAvatars(accountId);
      return { avatars };
    } catch (err) {
      return handleError(reply, err, 'listAvatars');
    }
  });

  // PATCH .../profile/avatar — change Zalo account avatar (upload by file path)
  app.patch(`${BASE}/avatar`, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const { filePath } = request.body as { filePath: string };
    const { orgId } = request.user!;
    if (!filePath) return reply.status(400).send({ error: 'filePath is required' });
    try {
      await resolveAccount(accountId, orgId);
      if (!await checkAccess(request, reply, accountId, 'admin')) return;
      const result = await zaloOps.changeAccountAvatar(accountId, filePath);
      return { success: true, result };
    } catch (err) {
      return handleError(reply, err, 'changeAccountAvatar');
    }
  });

  // DELETE .../profile/avatars/:avatarId — delete an avatar
  app.delete(`${BASE}/avatars/:avatarId`, async (request, reply) => {
    const { accountId, avatarId } = request.params as { accountId: string; avatarId: string };
    const { orgId } = request.user!;
    try {
      await resolveAccount(accountId, orgId);
      if (!await checkAccess(request, reply, accountId, 'admin')) return;
      const result = await deleteAvatar(accountId, avatarId);
      return result;
    } catch (err) {
      return handleError(reply, err, 'deleteAvatar');
    }
  });

  // POST .../profile/avatars/:avatarId/reuse — reuse a previous avatar
  app.post(`${BASE}/avatars/:avatarId/reuse`, async (request, reply) => {
    const { accountId, avatarId } = request.params as { accountId: string; avatarId: string };
    const { orgId } = request.user!;
    try {
      await resolveAccount(accountId, orgId);
      if (!await checkAccess(request, reply, accountId, 'admin')) return;
      const result = await reuseAvatar(accountId, avatarId);
      return result;
    } catch (err) {
      return handleError(reply, err, 'reuseAvatar');
    }
  });

  // PUT .../profile/status — set online/offline status
  app.put(`${BASE}/status`, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const { status } = request.body as { status: string };
    const { orgId } = request.user!;
    if (status !== 'online' && status !== 'offline') {
      return reply.status(400).send({ error: "status must be 'online' or 'offline'" });
    }
    try {
      await resolveAccount(accountId, orgId);
      if (!await checkAccess(request, reply, accountId, 'admin')) return;
      await zaloOps.setOnlineStatus(accountId, status === 'online');
      return { success: true };
    } catch (err) {
      return handleError(reply, err, 'setOnlineStatus');
    }
  });
}
