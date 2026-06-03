/**
 * Slot registry — điểm mở rộng UI cho plugin.
 *
 * Core đặt <ExtensionSlot name="..."/> rỗng tại các vị trí cần mở rộng.
 * Plugin (bundle ngoài) gọi registerSlot() để chèn component vào, không cần
 * core import component đó. Bản mặc định không có plugin → slot rỗng.
 */
import { shallowRef, type Component } from 'vue';

export interface SlotEntry {
  component: Component;
  /** Thứ tự render trong cùng 1 slot (nhỏ → trước). */
  order?: number;
  /** Nếu set, chỉ render khi feature này bật (useLicense). */
  requiresFeature?: string;
}

const slots = shallowRef<Record<string, SlotEntry[]>>({});

export function registerSlot(name: string, entry: SlotEntry): void {
  const list = slots.value[name] ?? [];
  list.push(entry);
  list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  slots.value = { ...slots.value, [name]: list };
}

export function getSlot(name: string): SlotEntry[] {
  return slots.value[name] ?? [];
}
