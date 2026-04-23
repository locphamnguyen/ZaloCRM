/**
 * video-processor.ts — Native video send for Zalo: ffmpeg detection, thumbnail generation,
 * upload orchestration, and fallback to plain attachment.
 * Ported from openzca/src/lib/video-send.ts with ZaloCRM service adapter.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { logger } from './utils/logger.js';

const execFileAsync = promisify(execFile);

export type VideoSendModePlan =
  | { mode: 'native' }
  | { mode: 'attachment'; reason: string };

export interface VideoProbeMetadata {
  durationMs?: number;
  width?: number;
  height?: number;
}

interface GeneratedThumbnail {
  path: string;
  cleanup: () => Promise<void>;
}

// ── ffmpeg availability ───────────────────────────────────────────────────────

/** Check if ffmpeg is available on PATH. Logs a warning when missing. */
export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    return true;
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      logger.warn('[video-processor] ffmpeg not found — native video mode unavailable');
      return false;
    }
    // Any other error (permissions, etc.) — treat as unavailable
    logger.warn('[video-processor] ffmpeg check failed:', err?.message ?? err);
    return false;
  }
}

// ── Send mode planning ────────────────────────────────────────────────────────

/**
 * Decide whether to use native Zalo video mode or fall back to plain attachment.
 * Native requires: ffmpeg available, exactly one .mp4 file.
 */
export function planVideoSendMode(params: {
  files: string[];
  ffmpegAvailable: boolean;
}): VideoSendModePlan {
  const { files, ffmpegAvailable } = params;

  if (!ffmpegAvailable) {
    return { mode: 'attachment', reason: 'ffmpeg is unavailable for native video mode' };
  }
  if (files.length !== 1) {
    return { mode: 'attachment', reason: 'native-video mode supports one video at a time' };
  }
  const ext = path.extname(files[0] ?? '').toLowerCase();
  if (ext !== '.mp4') {
    return { mode: 'attachment', reason: 'native-video mode currently supports .mp4 inputs only' };
  }
  return { mode: 'native' };
}

// ── ffprobe / thumbnail helpers ───────────────────────────────────────────────

async function runBinary(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${command} is required for native video mode`);
    }
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(stderr ? `${command} failed: ${stderr}` : `${command} failed: ${error?.message ?? String(error)}`);
  }
}

export function parseVideoProbeOutput(raw: string): VideoProbeMetadata {
  const parsed = JSON.parse(raw) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const width = toPositiveInteger(videoStream?.width);
  const height = toPositiveInteger(videoStream?.height);
  const durationSeconds =
    toPositiveNumber(videoStream?.duration) ?? toPositiveNumber(parsed.format?.duration);

  return {
    durationMs: durationSeconds ? Math.round(durationSeconds * 1000) : undefined,
    width,
    height,
  };
}

async function probeVideoFile(filePath: string): Promise<VideoProbeMetadata> {
  try {
    const raw = await runBinary('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    return parseVideoProbeOutput(raw);
  } catch {
    return {};
  }
}

async function generateThumbnail(videoPath: string): Promise<GeneratedThumbnail> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zalocrm-video-thumb-'));
  const outputPath = path.join(dir, 'thumbnail.jpg');

  try {
    await runBinary('ffmpeg', [
      '-y', '-ss', '1',
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ]);
    await fs.access(outputPath);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }

  return {
    path: outputPath,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

// ── URL pickers ───────────────────────────────────────────────────────────────

function pickVideoUrl(uploaded: unknown): string {
  const u = uploaded as Record<string, unknown> | undefined;
  if (!u || typeof u.fileUrl !== 'string' || u.fileUrl.length === 0) {
    throw new Error('Video upload did not return a file URL');
  }
  return u.fileUrl;
}

function pickThumbnailUrl(uploaded: unknown): string {
  const u = uploaded as Record<string, unknown> | undefined;
  if (!u || u.fileType !== 'image') {
    throw new Error('Thumbnail upload did not return an image result');
  }
  return String(u.normalUrl || u.hdUrl || u.thumbUrl);
}

// ── Public send function ──────────────────────────────────────────────────────

export interface SendNativeVideoParams {
  /** zca-js api instance */
  api: any;
  threadId: string;
  threadType: 0 | 1;
  videoPath: string;
  message?: string;
  /** Optional pre-generated thumbnail path; if omitted, ffmpeg generates one */
  thumbnailPath?: string;
}

/**
 * Upload video + thumbnail to Zalo and call api.sendVideo (native display mode).
 * Caller is responsible for deciding mode via planVideoSendMode before calling this.
 */
export async function sendNativeVideo(params: SendNativeVideoParams): Promise<unknown> {
  const metadata = await probeVideoFile(params.videoPath);
  const generated = params.thumbnailPath ? null : await generateThumbnail(params.videoPath);
  const thumbPath = params.thumbnailPath ?? generated?.path;

  if (!thumbPath) {
    throw new Error('Unable to resolve thumbnail path for native video send');
  }

  try {
    const [uploadedVideoArr, uploadedThumbArr] = await Promise.all([
      params.api.uploadAttachment([params.videoPath], params.threadId, params.threadType) as Promise<unknown[]>,
      params.api.uploadAttachment([thumbPath], params.threadId, params.threadType) as Promise<unknown[]>,
    ]);

    return await params.api.sendVideo(
      {
        msg: params.message ?? '',
        videoUrl: pickVideoUrl(uploadedVideoArr[0]),
        thumbnailUrl: pickThumbnailUrl(uploadedThumbArr[0]),
        duration: metadata.durationMs,
        width: metadata.width,
        height: metadata.height,
      },
      params.threadId,
      params.threadType,
    );
  } finally {
    await generated?.cleanup();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return undefined;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}
