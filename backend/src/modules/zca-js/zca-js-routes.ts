/**
 * zca-js Phase 1 handoff routes.
 *
 * zca-js remains the Zalo adapter/executor. This module accepts thin
 * conversation-event payloads and turns them into ZaloCRM account/contact/
 * conversation/message rows plus durable notifications.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

const CUSTOMER_STAGES = [
  'new_lead',
  'engaged',
  'sales_ready',
  'ordered',
  'paid',
  'cskh',
  'repeat',
  'lost',
  'opt_out',
] as const;

type CustomerStage = (typeof CUSTOMER_STAGES)[number];
type ThreadType = 'user' | 'group';
type Direction = 'inbound' | 'outbound';
type DbClient = any;

interface SyncPayload {
  event_id: string;
  account_id: string;
  thread_id: string;
  thread_type: ThreadType;
  direction: Direction;
  source_id?: string;
  campaign_id?: string;
  template_id?: string;
  script_id?: string;
  zalo_crm_thread_url?: string;
  message_text?: string;
  content_type?: string;
  sender_uid?: string;
  sender_name?: string;
  contact_name?: string;
  group_name?: string;
  group_avatar_url?: string;
  group_members_count?: number;
  attachments: unknown[];
  raw: Record<string, unknown>;
  created_at: string;
  org_id?: string;
  owner_user_id?: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getNumber(source: unknown, key: string): number | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim());
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}

function normalizePayload(body: unknown): { payload?: SyncPayload; errors: string[] } {
  if (!isRecord(body)) return { errors: ['payload must be a JSON object'] };

  const raw = isRecord(body.raw) ? body.raw : {};
  const eventId = firstString(getString(body, 'event_id'), getString(body, 'eventId'));
  const accountId = firstString(getString(body, 'account_id'), getString(body, 'accountId'));
  const threadId = firstString(getString(body, 'thread_id'), getString(body, 'threadId'));
  const threadTypeRaw = firstString(getString(body, 'thread_type'), getString(body, 'threadType')) ?? 'user';
  const directionRaw = getString(body, 'direction') ?? 'inbound';
  const createdAt = firstString(getString(body, 'created_at'), getString(body, 'createdAt')) ?? new Date().toISOString();

  const errors: string[] = [];
  if (!eventId) errors.push('event_id is required');
  if (!accountId) errors.push('account_id is required');
  if (!threadId) errors.push('thread_id is required');
  if (threadTypeRaw !== 'user' && threadTypeRaw !== 'group') errors.push('thread_type must be user or group');
  if (directionRaw !== 'inbound' && directionRaw !== 'outbound') errors.push('direction must be inbound or outbound');
  if (Number.isNaN(new Date(createdAt).getTime())) errors.push('created_at must be a valid ISO datetime');

  const attachments = Array.isArray(body.attachments)
    ? body.attachments
    : Array.isArray(raw.attachments)
      ? raw.attachments
      : [];

  if (errors.length > 0) return { errors };

  return {
    errors: [],
    payload: {
      event_id: eventId!,
      account_id: accountId!,
      thread_id: threadId!,
      thread_type: threadTypeRaw as ThreadType,
      direction: directionRaw as Direction,
      source_id: firstString(getString(body, 'source_id'), getString(body, 'sourceId')),
      campaign_id: firstString(getString(body, 'campaign_id'), getString(body, 'campaignId')),
      template_id: firstString(getString(body, 'template_id'), getString(body, 'templateId')),
      script_id: firstString(getString(body, 'script_id'), getString(body, 'scriptId')),
      zalo_crm_thread_url: firstString(getString(body, 'zalo_crm_thread_url'), getString(body, 'zaloCrmThreadUrl')),
      message_text: firstString(
        getString(body, 'message_text'),
        getString(body, 'message'),
        getString(body, 'text'),
        getString(raw, 'message_text'),
        getString(raw, 'message'),
        getString(raw, 'text'),
      ),
      content_type: firstString(getString(body, 'content_type'), getString(body, 'contentType'), getString(raw, 'content_type')) ?? 'text',
      sender_uid: firstString(getString(body, 'sender_uid'), getString(body, 'senderUid'), getString(raw, 'sender_uid')),
      sender_name: firstString(getString(body, 'sender_name'), getString(body, 'senderName'), getString(raw, 'sender_name')),
      contact_name: firstString(getString(body, 'contact_name'), getString(body, 'customer_name'), getString(raw, 'contact_name')),
      group_name: firstString(getString(body, 'group_name'), getString(body, 'groupName'), getString(raw, 'group_name')),
      group_avatar_url: firstString(getString(body, 'group_avatar_url'), getString(body, 'groupAvatarUrl'), getString(raw, 'group_avatar_url')),
      group_members_count: getNumber(body, 'group_members_count') ?? getNumber(body, 'groupMembersCount') ?? getNumber(raw, 'group_members_count'),
      attachments,
      raw: Object.keys(raw).length > 0 ? raw : body,
      created_at: createdAt,
      org_id: firstString(getString(body, 'org_id'), getString(body, 'orgId')),
      owner_user_id: firstString(getString(body, 'owner_user_id'), getString(body, 'ownerUserId')),
    },
  };
}

function mergeZcaMetadata(existing: unknown, payload: SyncPayload, conversationId?: string): Record<string, unknown> {
  const base = isRecord(existing) ? { ...existing } : {};
  const currentZca = isRecord(base.zcaJs) ? base.zcaJs : {};
  const zcaJs: Record<string, unknown> = {
    ...currentZca,
    account_id: payload.account_id,
    thread_id: payload.thread_id,
    thread_type: payload.thread_type,
    source_id: payload.source_id ?? currentZca.source_id,
    campaign_id: payload.campaign_id ?? currentZca.campaign_id,
    template_id: payload.template_id ?? currentZca.template_id,
    script_id: payload.script_id ?? currentZca.script_id,
    conversation_id: conversationId ?? currentZca.conversation_id,
    last_event_id: payload.event_id,
    last_direction: payload.direction,
    last_synced_at: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(zcaJs)) {
    if (value === undefined) delete zcaJs[key];
  }
  base.zcaJs = zcaJs;
  return base;
}

async function resolveOrgId(request: FastifyRequest, payload: SyncPayload, reply: FastifyReply): Promise<string | null> {
  const configuredSecret = process.env.ZALOCRM_SYNC_SECRET;
  if (configuredSecret) {
    const supplied = request.headers['x-zalocrm-sync-secret'];
    if (supplied !== configuredSecret) {
      reply.status(401).send({ ok: false, error: 'Invalid sync secret' });
      return null;
    }
  }

  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) {
    const setting = await prisma.appSetting.findFirst({
      where: { settingKey: 'public_api_key', valuePlain: apiKey.trim() },
      select: { orgId: true },
    });
    if (!setting) {
      reply.status(401).send({ ok: false, error: 'Invalid API key' });
      return null;
    }
    return setting.orgId;
  }

  const requestedOrgId = payload.org_id ?? (typeof request.headers['x-zalocrm-org-id'] === 'string'
    ? request.headers['x-zalocrm-org-id']
    : undefined);
  if (requestedOrgId) {
    const org = await prisma.organization.findUnique({ where: { id: requestedOrgId }, select: { id: true } });
    if (!org) {
      reply.status(404).send({ ok: false, error: 'Organization not found' });
      return null;
    }
    return org.id;
  }

  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (process.env.NODE_ENV === 'production') {
    reply.status(400).send({
      ok: false,
      error: 'Organization identity is required in production. Send X-API-Key, X-ZaloCRM-Org-Id, or org_id.',
    });
    return null;
  }
  if (!org) {
    reply.status(409).send({ ok: false, error: 'ZaloCRM setup required before zca-js sync' });
    return null;
  }
  return org.id;
}

async function resolveOwnerUserId(orgId: string, preferredUserId?: string): Promise<string> {
  if (preferredUserId) {
    const preferred = await prisma.user.findFirst({
      where: { id: preferredUserId, orgId, isActive: true },
      select: { id: true },
    });
    if (preferred) return preferred.id;
  }

  const owner = await prisma.user.findFirst({
    where: { orgId, isActive: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (!owner) {
    throw new Error('No active user exists for organization');
  }
  return owner.id;
}

async function upsertZaloAccount(db: DbClient, orgId: string, ownerUserId: string, externalAccountId: string) {
  return db.zaloAccount.upsert({
    where: {
      orgId_externalAccountId: {
        orgId,
        externalAccountId,
      },
    },
    create: {
      orgId,
      ownerUserId,
      externalAccountId,
      displayName: externalAccountId,
      status: 'disconnected',
    },
    update: {},
    select: {
      id: true,
      orgId: true,
      ownerUserId: true,
      externalAccountId: true,
      displayName: true,
      avatarUrl: true,
      phone: true,
    },
  });
}

async function upsertContact(db: DbClient, orgId: string, payload: SyncPayload) {
  if (payload.thread_type !== 'user') return null;

  const contactName = firstString(payload.contact_name, payload.sender_name, `Zalo ${payload.thread_id.slice(-4)}`);
  const initialStage: CustomerStage = payload.direction === 'inbound' ? 'engaged' : 'new_lead';
  const existing = await db.contact.findFirst({
    where: { orgId, zaloUid: payload.thread_id, mergedInto: null },
    select: {
      id: true,
      fullName: true,
      source: true,
      metadata: true,
      currentStage: true,
      assignedUserId: true,
      lastInboundAt: true,
      lastOutboundAt: true,
    },
  });

  if (!existing) {
    const created = await db.contact.create({
      data: {
        id: randomUUID(),
        orgId,
        zaloUid: payload.thread_id,
        fullName: contactName,
        source: payload.source_id ?? 'zca-js',
        currentStage: initialStage,
        hasZalo: true,
        lastActivity: new Date(payload.created_at),
        metadata: mergeZcaMetadata({}, payload),
      },
      select: {
        id: true,
        fullName: true,
        source: true,
        metadata: true,
        currentStage: true,
        assignedUserId: true,
        lastInboundAt: true,
        lastOutboundAt: true,
      },
    });
    await db.customerStageHistory.create({
      data: {
        id: randomUUID(),
        orgId,
        contactId: created.id,
        oldStage: null,
        newStage: initialStage,
        reason: 'Created from zca-js conversation sync',
        operator: 'zca-js',
        metadata: { event_id: payload.event_id, source: 'zca-js' },
      },
    });
    return created;
  }

  const stagePatch: { currentStage?: CustomerStage } = {};
  if (payload.direction === 'inbound' && existing.currentStage === 'new_lead') {
    stagePatch.currentStage = 'engaged';
  }

  const updated = await db.contact.update({
    where: { id: existing.id },
    data: {
      ...(contactName && existing.fullName === 'Unknown' ? { fullName: contactName } : {}),
      ...(payload.source_id && !existing.source ? { source: payload.source_id } : {}),
      ...stagePatch,
      hasZalo: true,
      lastActivity: new Date(payload.created_at),
      metadata: mergeZcaMetadata(existing.metadata, payload),
    },
    select: {
      id: true,
      fullName: true,
      source: true,
      metadata: true,
      currentStage: true,
      assignedUserId: true,
      lastInboundAt: true,
      lastOutboundAt: true,
    },
  });

  if (stagePatch.currentStage) {
    await db.customerStageHistory.create({
      data: {
        id: randomUUID(),
        orgId,
        contactId: existing.id,
        oldStage: existing.currentStage,
        newStage: stagePatch.currentStage,
        reason: 'Inbound zca-js message',
        operator: 'zca-js',
        metadata: { event_id: payload.event_id, source: 'zca-js' },
      },
    });
  }

  return updated;
}

async function upsertConversation(db: DbClient, orgId: string, accountId: string, contactId: string | null, payload: SyncPayload) {
  const updateData: Record<string, unknown> = {};
  if (payload.thread_type === 'user' && contactId) updateData.contactId = contactId;
  if (payload.thread_type === 'group') {
    if (payload.group_name) updateData.groupName = payload.group_name;
    if (payload.group_avatar_url) updateData.groupAvatarUrl = payload.group_avatar_url;
    if (payload.group_members_count != null) updateData.groupMembersCount = payload.group_members_count;
  }

  return db.conversation.upsert({
    where: {
      zaloAccountId_externalThreadId: {
        zaloAccountId: accountId,
        externalThreadId: payload.thread_id,
      },
    },
    create: {
      id: randomUUID(),
      orgId,
      zaloAccountId: accountId,
      contactId,
      threadType: payload.thread_type,
      externalThreadId: payload.thread_id,
      groupName: payload.thread_type === 'group' ? payload.group_name ?? null : null,
      groupAvatarUrl: payload.thread_type === 'group' ? payload.group_avatar_url ?? null : null,
      groupMembersCount: payload.thread_type === 'group' ? payload.group_members_count ?? null : null,
      unreadCount: 0,
      isReplied: true,
    },
    update: updateData,
    select: { id: true, lastMessageAt: true, contactId: true, groupName: true, groupAvatarUrl: true, groupMembersCount: true },
  });
}

async function createMessageOnce(db: DbClient, conversationId: string, accountId: string, contactName: string | null, payload: SyncPayload) {
  const occurredAt = new Date(payload.created_at);
  const senderType = payload.direction === 'outbound' ? 'self' : 'contact';
  const senderUid = payload.sender_uid ?? (payload.direction === 'outbound' ? accountId : payload.thread_id);
  const senderName = payload.sender_name ?? (senderType === 'contact' ? contactName : accountId);

  try {
    return await db.message.create({
      data: {
        id: randomUUID(),
        conversationId,
        zaloMsgId: payload.event_id,
        senderType,
        senderUid,
        senderName,
        content: payload.message_text ?? '',
        contentType: payload.content_type ?? 'text',
        attachments: payload.attachments as any,
        sentAt: occurredAt,
      },
      select: { id: true, sentAt: true, content: true, contentType: true, senderType: true },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      const existing = await db.message.findFirst({
        where: { conversationId, zaloMsgId: payload.event_id },
        select: { id: true, sentAt: true, content: true, contentType: true, senderType: true },
      });
      if (existing) return existing;
    }
    throw err;
  }
}

async function updateAggregates(
  db: DbClient,
  orgId: string,
  accountId: string,
  contactId: string | null,
  conversationId: string,
  message: { id: string; sentAt: Date; content: string | null; contentType: string; senderType: string },
  payload: SyncPayload,
) {
  const occurredAt = new Date(payload.created_at);
  const newerLastMessage = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { lastMessageAt: true },
  });
  const shouldAdvanceLastMessage = !newerLastMessage?.lastMessageAt || occurredAt >= newerLastMessage.lastMessageAt;

  await db.conversation.update({
    where: { id: conversationId },
    data: {
      ...(shouldAdvanceLastMessage ? { lastMessageAt: occurredAt } : {}),
      ...(payload.direction === 'inbound'
        ? { unreadCount: { increment: 1 }, isReplied: false }
        : { unreadCount: 0, isReplied: true }),
    },
  });

  if (!contactId || payload.thread_type !== 'user') return;

  const preview = payload.message_text ?? '';
  const existingContact = await db.contact.findUnique({
    where: { id: contactId },
    select: { metadata: true },
  });
  await db.contact.update({
    where: { id: contactId },
    data: {
      lastActivity: occurredAt,
      metadata: mergeZcaMetadata(existingContact?.metadata, payload, conversationId),
      ...(payload.direction === 'inbound'
        ? {
            lastInboundAt: occurredAt,
            lastInboundMessageId: message.id,
            lastInboundPreview: preview,
            lastInboundType: message.contentType,
            totalInbound: { increment: 1 },
          }
        : {
            lastOutboundAt: occurredAt,
            lastOutboundMessageId: message.id,
            lastOutboundPreview: preview,
            lastOutboundType: message.contentType,
            lastOutboundByZaloAccountId: accountId,
            totalOutbound: { increment: 1 },
          }),
    },
  }).catch((err: unknown) => logger.warn('[zca-js] contact aggregate update failed:', err));

  const existingFriend = await db.friend.findUnique({
    where: {
      zaloAccountId_zaloUidInNick: {
        zaloAccountId: accountId,
        zaloUidInNick: payload.thread_id,
      },
    },
    select: { id: true, relationshipKind: true },
  }).catch(() => null);

  if (!existingFriend) {
    await db.friend.create({
      data: {
        id: randomUUID(),
        orgId,
        contactId,
        zaloAccountId: accountId,
        zaloUidInNick: payload.thread_id,
        hasConversation: true,
        relationshipKind: 'chatting_stranger',
        firstMessageAt: occurredAt,
        zaloDisplayName: payload.contact_name ?? payload.sender_name ?? null,
        ...(payload.direction === 'inbound'
          ? { lastInboundAt: occurredAt, totalInbound: 1 }
          : { lastOutboundAt: occurredAt, totalOutbound: 1 }),
      },
    }).catch((err: unknown) => logger.warn('[zca-js] friend create failed:', err));
    return;
  }

  await db.friend.update({
    where: { id: existingFriend.id },
    data: {
      hasConversation: true,
      ...(existingFriend.relationshipKind === 'none' || existingFriend.relationshipKind === 'ghost'
        ? { relationshipKind: 'chatting_stranger' }
        : {}),
      ...(payload.direction === 'inbound'
        ? { lastInboundAt: occurredAt, totalInbound: { increment: 1 } }
        : { lastOutboundAt: occurredAt, totalOutbound: { increment: 1 } }),
    },
  }).catch((err: unknown) => logger.warn('[zca-js] friend update failed:', err));
}

async function createInboundNotification(
  db: DbClient,
  orgId: string,
  account: { id: string; ownerUserId: string; displayName: string | null },
  contactId: string | null,
  assignedUserId: string | null | undefined,
  conversationId: string,
  messageId: string,
  payload: SyncPayload,
) {
  if (payload.direction !== 'inbound') return null;

  const ownerUserId = assignedUserId ?? account.ownerUserId;
  const preview = payload.message_text ? `: ${payload.message_text.slice(0, 140)}` : '';
  return db.notification.upsert({
    where: {
      orgId_eventId: {
        orgId,
        eventId: payload.event_id,
      },
    },
    create: {
      id: randomUUID(),
      orgId,
      type: 'new_inbox',
      title: 'Inbox Zalo mới',
      message: `Có inbox Zalo mới từ ${payload.thread_id}${preview}`,
      priority: 'medium',
      status: 'sent',
      eventId: payload.event_id,
      ownerUserId,
      accountId: account.id,
      conversationId,
      messageId,
      contactId,
      threadId: payload.thread_id,
      metadata: compactRecord({
        event_id: payload.event_id,
        account_id: payload.account_id,
        thread_id: payload.thread_id,
        thread_type: payload.thread_type,
        source_id: payload.source_id,
        campaign_id: payload.campaign_id,
        template_id: payload.template_id,
        script_id: payload.script_id,
        zalo_crm_thread_url: payload.zalo_crm_thread_url,
      }),
    },
    update: {},
    select: { id: true, type: true, status: true, ownerUserId: true, createdAt: true },
  });
}

export async function zcaJsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/zca-js/conversations/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { payload, errors } = normalizePayload(request.body);
      if (!payload) return reply.status(400).send({ ok: false, error: 'Invalid payload', details: errors });

      const orgId = await resolveOrgId(request, payload, reply);
      if (!orgId) return reply;

      const ownerUserId = await resolveOwnerUserId(orgId, payload.owner_user_id);
      try {
        const result = await prisma.$transaction(async (tx) => {
          const db = tx as DbClient;
          const account = await upsertZaloAccount(db, orgId, ownerUserId, payload.account_id);

          await db.conversationEvent.create({
            data: {
              id: randomUUID(),
              orgId,
              eventId: payload.event_id,
              accountId: account.id,
              accountExternalId: payload.account_id,
              threadId: payload.thread_id,
              threadType: payload.thread_type,
              direction: payload.direction,
              messageText: payload.message_text ?? null,
              attachments: payload.attachments as any,
              campaignId: payload.campaign_id ?? null,
              sourceId: payload.source_id ?? null,
              templateId: payload.template_id ?? null,
              scriptId: payload.script_id ?? null,
              zaloCrmThreadUrl: payload.zalo_crm_thread_url ?? null,
              raw: payload.raw as any,
              occurredAt: new Date(payload.created_at),
            },
          });

          await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`zca-sync:${orgId}:${account.id}:${payload.thread_id}`}))`;

          const contact = await upsertContact(db, orgId, payload);
          const conversation = await upsertConversation(db, orgId, account.id, contact?.id ?? null, payload);
          const message = await createMessageOnce(db, conversation.id, account.id, contact?.fullName ?? null, payload);

          await updateAggregates(db, orgId, account.id, contact?.id ?? null, conversation.id, message, payload);

          const event = await db.conversationEvent.update({
            where: {
              orgId_eventId: {
                orgId,
                eventId: payload.event_id,
              },
            },
            data: {
              conversationId: conversation.id,
              messageId: message.id,
              contactId: contact?.id ?? null,
            },
            select: {
              id: true,
              eventId: true,
              accountId: true,
              accountExternalId: true,
              conversationId: true,
              messageId: true,
              contactId: true,
              occurredAt: true,
            },
          });

          const notification = await createInboundNotification(
            db,
            orgId,
            { id: account.id, ownerUserId: account.ownerUserId, displayName: account.displayName },
            contact?.id ?? null,
            contact?.assignedUserId,
            conversation.id,
            message.id,
            payload,
          );

          return {
            duplicate: false,
            account: { id: account.id, externalAccountId: account.externalAccountId, displayName: account.displayName },
            contact: contact ? { id: contact.id, currentStage: contact.currentStage, source: contact.source } : null,
            conversation: { id: conversation.id, threadId: payload.thread_id, threadType: payload.thread_type },
            message: { id: message.id },
            event,
            notification,
          };
        });

        return reply.send({ ok: true, data: result });
      } catch (err) {
        if (isUniqueViolation(err)) {
          const duplicate = await prisma.conversationEvent.findUnique({
            where: {
              orgId_eventId: {
                orgId,
                eventId: payload.event_id,
              },
            },
            select: {
              id: true,
              eventId: true,
              accountId: true,
              accountExternalId: true,
              conversationId: true,
              messageId: true,
              contactId: true,
              occurredAt: true,
            },
          });
          if (duplicate) {
            return reply.send({
              ok: true,
              data: {
                duplicate: true,
                event: duplicate,
              },
            });
          }
        }
        throw err;
      }
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode ?? 500;
      logger.error('[zca-js] sync error:', err);
      return reply.status(statusCode).send({ ok: false, error: (err as Error).message || 'Failed to sync conversation' });
    }
  });
}
