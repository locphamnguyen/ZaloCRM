// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { ref } from 'vue';

/**
 * use-confirm — hộp xác nhận đẹp HS theme, thay window.confirm/prompt của Chrome.
 *
 * Promise-based để chỗ gọi chỉ cần đổi 1 dòng:
 *   if (!confirm('Xoá?')) return;
 *     →
 *   if (!(await confirm({ title: 'Xoá?', tone: 'danger' }))) return;
 *
 * Singleton: <ConfirmHost/> mount 1 lần ở App.vue render `confirmState` qua
 * ConfirmActionModal. Dùng chung như useToast().
 */
export interface ConfirmOptions {
  title: string;
  message?: string;
  tone?: 'primary' | 'danger';
  confirmText?: string;
  cancelText?: string;
  /** Bắt nhập lý do (textarea) — trả về reason qua confirmWithReason(). */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
}

// State + resolver dùng chung (module-level singleton).
export const confirmState = ref<ConfirmState>({ open: false, title: '' });
let pending: ((r: { ok: boolean; reason: string }) => void) | null = null;

/** ConfirmHost gọi khi user bấm Xác nhận/Hủy/đóng. */
export function resolveConfirm(ok: boolean, reason: string): void {
  confirmState.value.open = false;
  const p = pending;
  pending = null;
  if (p) p({ ok, reason });
}

export function useConfirm() {
  /** Mở hộp xác nhận → resolve true nếu user xác nhận, false nếu hủy/đóng. */
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    if (pending) resolveConfirm(false, ''); // hộp cũ đang mở → coi như hủy.
    return new Promise<boolean>((resolve) => {
      pending = (r) => resolve(r.ok);
      confirmState.value = { ...opts, tone: opts.tone ?? 'primary', open: true };
    });
  }

  /** Bản có ô lý do — trả { ok, reason }. */
  function confirmWithReason(opts: ConfirmOptions): Promise<{ ok: boolean; reason: string }> {
    if (pending) resolveConfirm(false, '');
    return new Promise<{ ok: boolean; reason: string }>((resolve) => {
      pending = resolve;
      confirmState.value = { ...opts, tone: opts.tone ?? 'primary', requireReason: true, open: true };
    });
  }

  return { confirm, confirmWithReason };
}
