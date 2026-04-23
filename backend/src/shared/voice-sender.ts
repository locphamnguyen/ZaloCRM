/**
 * voice-sender.ts — Voice message upload and send service for ZaloCRM.
 * Accepts a local audio file path (m4a/mp3/ogg/wav/webm) and sends via zca-js api.sendVoice.
 * File size validated before upload (5MB Zalo limit).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ZaloOpError } from './zalo-operations.js';
import { logger } from './utils/logger.js';

const MAX_VOICE_BYTES = 5 * 1024 * 1024; // 5MB

const ALLOWED_EXTENSIONS = new Set(['.m4a', '.mp3', '.ogg', '.wav', '.webm', '.aac']);

export interface VoiceSendParams {
  /** zca-js api instance (resolved from pool) */
  api: any;
  threadId: string;
  threadType: 0 | 1;
  /** Absolute path to audio file on server filesystem */
  audioPath: string;
  /** Duration in milliseconds (optional, passed to Zalo metadata) */
  durationMs?: number;
}

export interface VoiceSendResult {
  success: boolean;
  data?: unknown;
}

/**
 * Validate and send a voice message via zca-js.
 * Throws ZaloOpError for validation failures so callers get typed HTTP codes.
 */
export async function sendVoiceFile(params: VoiceSendParams): Promise<VoiceSendResult> {
  const { api, threadId, threadType, audioPath, durationMs } = params;

  // 1. Extension check
  const ext = path.extname(audioPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new ZaloOpError(
      `Unsupported audio format: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      'INVALID_PARAMS',
      400,
    );
  }

  // 2. File existence + size check
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(audioPath);
  } catch {
    throw new ZaloOpError(`Audio file not found: ${audioPath}`, 'INVALID_PARAMS', 400);
  }

  if (stat.size > MAX_VOICE_BYTES) {
    throw new ZaloOpError(
      `Audio file too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max 5MB)`,
      'INVALID_PARAMS',
      400,
    );
  }

  if (stat.size === 0) {
    throw new ZaloOpError('Audio file is empty', 'INVALID_PARAMS', 400);
  }

  // 3. Send via zca-js — duration converted from ms to seconds if provided
  const durationSeconds = durationMs ? Math.round(durationMs / 1000) : undefined;
  try {
    const result = await api.sendVoice(audioPath, threadId, threadType, durationSeconds);
    logger.info(`[voice-sender] Voice sent to thread ${threadId} (${(stat.size / 1024).toFixed(1)}KB)`);
    return { success: true, data: result };
  } catch (err: any) {
    logger.error('[voice-sender] sendVoice failed:', err?.message ?? err);
    throw new ZaloOpError(
      `Voice send failed: ${err?.message ?? String(err)}`,
      'API_ERROR',
      500,
    );
  }
}
