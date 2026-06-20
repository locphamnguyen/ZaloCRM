// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { ref } from 'vue';

export type ToastType = 'default' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  handler: () => void | Promise<void>;
}

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;          // optional action button (vd "Hoàn tác")
  expiresAt?: number;            // epoch ms — cho progress bar countdown
}

const items = ref<ToastItem[]>([]);
let counter = 0;

/**
 * Singleton toast service. Mọi component đều push message qua `useToast().push()`.
 * `<ToastContainer/>` mount ở DefaultLayout sẽ render queue.
 *
 * Undo pattern: toast.undo(msg, handler) → button "Hoàn tác" hiện 5s, click
 * → gọi handler + dismiss toast. Gmail-style.
 */
export function useToast() {
  function push(message: string, type: ToastType = 'default', durationMs = 2400) {
    const id = ++counter;
    items.value.push({ id, message, type, expiresAt: Date.now() + durationMs });
    setTimeout(() => {
      items.value = items.value.filter(t => t.id !== id);
    }, durationMs);
    return id;
  }

  function pushWithAction(
    message: string,
    action: ToastAction,
    type: ToastType = 'default',
    durationMs = 5000,
  ): number {
    const id = ++counter;
    items.value.push({ id, message, type, action, expiresAt: Date.now() + durationMs });
    setTimeout(() => {
      items.value = items.value.filter(t => t.id !== id);
    }, durationMs);
    return id;
  }

  /** Undo toast: "Đã đổi trạng thái → X. [Hoàn tác]" 5s.
   *  handler được wrapped: tự dismiss toast sau khi chạy xong. */
  function undo(message: string, handler: () => void | Promise<void>, durationMs = 5000): number {
    let id = -1;
    id = pushWithAction(
      message,
      {
        label: 'Hoàn tác',
        handler: async () => {
          await handler();
          items.value = items.value.filter(t => t.id !== id);
        },
      },
      'default',
      durationMs,
    );
    return id;
  }

  return {
    items,
    push,
    pushWithAction,
    undo,
    success: (msg: string, dur?: number) => push(msg, 'success', dur),
    warning: (msg: string, dur?: number) => push(msg, 'warning', dur),
    error:   (msg: string, dur?: number) => push(msg, 'error', dur),
    dismiss: (id: number) => { items.value = items.value.filter(t => t.id !== id); },
  };
}
