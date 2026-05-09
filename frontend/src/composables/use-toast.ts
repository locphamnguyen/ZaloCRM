import { ref } from 'vue';

export type ToastType = 'default' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const items = ref<ToastItem[]>([]);
let counter = 0;

/**
 * Singleton toast service. Mọi component đều push message qua `useToast().push()`.
 * `<ToastContainer/>` mount ở DefaultLayout sẽ render queue.
 *
 * Mockup chat-smax-v3 dùng toast cho mọi action (lưu, click, đổi trạng thái...).
 */
export function useToast() {
  function push(message: string, type: ToastType = 'default', durationMs = 2400) {
    const id = ++counter;
    items.value.push({ id, message, type });
    setTimeout(() => {
      items.value = items.value.filter(t => t.id !== id);
    }, durationMs);
  }

  return {
    items,
    push,
    success: (msg: string, dur?: number) => push(msg, 'success', dur),
    warning: (msg: string, dur?: number) => push(msg, 'warning', dur),
    error:   (msg: string, dur?: number) => push(msg, 'error', dur),
    dismiss: (id: number) => { items.value = items.value.filter(t => t.id !== id); },
  };
}
