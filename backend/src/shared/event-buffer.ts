/**
 * event-buffer.ts — Event batching for typing indicators + reactions.
 * Uses Redis pub/sub when REDIS_URL is set, otherwise in-memory Maps.
 * Aggregates high-frequency Socket.IO events to prevent event storms.
 */
import type { Server } from 'socket.io';
import type { RedisClient } from './redis-client.js';
import { logger } from './utils/logger.js';
import { getRedis } from './redis-client.js';

interface TypingEntry {
  userId: string;
  userName: string;
  expiresAt: number;
}

const FLUSH_INTERVAL_MS = 1_000;
const TYPING_TTL_MS = 5_000;

// In-memory fallback buffers
const memTyping = new Map<string, Map<string, TypingEntry>>();
const memReactions = new Map<string, { msgId: string; conversationId: string; reactions: Array<{ userId: string; userName: string; reaction: string; action: 'add' | 'remove' }> }>();

let flushTimer: ReturnType<typeof setInterval> | null = null;
let ioRef: Server | null = null;
let redis: RedisClient | null = null;

const TYPING_KEY = (convId: string) => `eb:typing:${convId}`;
const REACTION_KEY = (convId: string) => `eb:react:${convId}`;

const REACTION_ALIASES: Record<string, string> = {
  heart: '❤️',
  like: '👍',
  haha: '😆',
  wow: '😮',
  sad: '😭',
  angry: '😡',
};

function normalizeReaction(reaction: string): string {
  return REACTION_ALIASES[reaction.toLowerCase()] ?? reaction;
}

async function start(io: Server): Promise<void> {
  ioRef = io;
  if (flushTimer) return;
  redis = await getRedis();
  flushTimer = setInterval(() => flush(), FLUSH_INTERVAL_MS);
  logger.info('[event-buffer] Started (mode: %s)', redis ? 'redis' : 'in-memory');
}

function stop(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  memTyping.clear();
  memReactions.clear();
  ioRef = null;
  redis = null;
  logger.info('[event-buffer] Stopped');
}

async function recordTyping(conversationId: string, userId: string, userName: string): Promise<void> {
  const entry: TypingEntry = { userId, userName, expiresAt: Date.now() + TYPING_TTL_MS };

  if (redis) {
    try {
      await redis.hset(TYPING_KEY(conversationId), userId, JSON.stringify(entry));
      await redis.pexpire(TYPING_KEY(conversationId), TYPING_TTL_MS * 2);
      return;
    } catch { /* fall through to in-memory */ }
  }

  let convTypers = memTyping.get(conversationId);
  if (!convTypers) {
    convTypers = new Map();
    memTyping.set(conversationId, convTypers);
  }
  convTypers.set(userId, entry);
}

async function clearTyping(conversationId: string, userId: string): Promise<void> {
  if (redis) {
    try {
      await redis.hdel(TYPING_KEY(conversationId), userId);
      return;
    } catch { /* fall through */ }
  }

  const convTypers = memTyping.get(conversationId);
  if (convTypers) {
    convTypers.delete(userId);
    if (convTypers.size === 0) memTyping.delete(conversationId);
  }
}

async function recordReaction(
  conversationId: string, msgId: string,
  userId: string, userName: string,
  reaction: string, action: 'add' | 'remove' = 'add',
): Promise<void> {
  const entry = JSON.stringify({ userId, userName, reaction: normalizeReaction(reaction), action });

  if (redis) {
    try {
      const key = REACTION_KEY(conversationId);
      await redis.hset(key, 'msgId', msgId);
      await redis.rpush(`${key}:list`, entry);
      await redis.pexpire(key, FLUSH_INTERVAL_MS * 3);
      await redis.pexpire(`${key}:list`, FLUSH_INTERVAL_MS * 3);
      return;
    } catch { /* fall through */ }
  }

  let batch = memReactions.get(conversationId);
  if (!batch || batch.msgId !== msgId) {
    batch = { msgId, conversationId, reactions: [] };
    memReactions.set(conversationId, batch);
  }
  batch.reactions.push({ userId, userName, reaction, action });
}

async function flush(): Promise<void> {
  if (!ioRef) return;

  if (redis) {
    await flushRedis();
  } else {
    flushMemory();
  }
}

function flushMemory(): void {
  const now = Date.now();
  for (const [conversationId, typers] of memTyping) {
    for (const [uid, entry] of typers) {
      if (entry.expiresAt <= now) typers.delete(uid);
    }
    ioRef!.emit('chat:typing', {
      conversationId,
      typers: Array.from(typers.values()).map(t => ({ userId: t.userId, userName: t.userName })),
    });
    if (typers.size === 0) memTyping.delete(conversationId);
  }

  for (const [, batch] of memReactions) {
    if (batch.reactions.length > 0) {
      ioRef!.emit('chat:reactions', {
        conversationId: batch.conversationId,
        msgId: batch.msgId,
        reactions: batch.reactions.map(reaction => ({
          ...reaction,
          reaction: normalizeReaction(reaction.reaction),
        })),
      });
    }
  }
  memReactions.clear();
}

async function flushRedis(): Promise<void> {
  if (!redis) return;
  const now = Date.now();

  try {
    // Typing: scan all typing keys
    const typingKeys = await scanKeys('eb:typing:*');
    for (const key of typingKeys) {
      const conversationId = key.replace('eb:typing:', '');
      const entries = await redis.hgetall(key);
      const active: Array<{ userId: string; userName: string }> = [];

      for (const [uid, raw] of Object.entries(entries)) {
        const entry = JSON.parse(raw as string) as TypingEntry;
        if (entry.expiresAt <= now) {
          await redis.hdel(key, uid);
        } else {
          active.push({ userId: entry.userId, userName: entry.userName });
        }
      }

      if (active.length > 0 || Object.keys(entries).length > 0) {
        ioRef!.emit('chat:typing', { conversationId, typers: active });
      }
    }

    // Reactions: scan all reaction keys
    const reactKeys = await scanKeys('eb:react:*');
    const processed = new Set<string>();
    for (const key of reactKeys) {
      const base = key.replace(/:list$/, '');
      if (processed.has(base)) continue;
      processed.add(base);

      const conversationId = base.replace('eb:react:', '');
      const msgId = await redis.hget(base, 'msgId');
      const listKey = `${base}:list`;
      const items = await redis.lrange(listKey, 0, -1);

      if (msgId && items.length > 0) {
        const reactions = items.map((i: string) => {
        const parsed = JSON.parse(i) as { userId: string; userName: string; reaction: string; action: 'add' | 'remove' };
        return { ...parsed, reaction: normalizeReaction(parsed.reaction) };
      });
        ioRef!.emit('chat:reactions', { conversationId, msgId, reactions });
      }

      await redis.del(base, listKey);
    }
  } catch (err) {
    logger.warn('[event-buffer] Redis flush error, falling back: %s', (err as Error).message);
    redis = null;
    flushMemory();
  }
}

async function scanKeys(pattern: string): Promise<string[]> {
  if (!redis) return [];
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

export const eventBuffer = { start, stop, recordTyping, clearTyping, recordReaction };
