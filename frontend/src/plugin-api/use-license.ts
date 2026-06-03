/**
 * useLicense — feature flags phía frontend (bản stub).
 *
 * Mặc định: tập feature rỗng → has() luôn false (slot có requiresFeature bị ẩn).
 * Sau này setFeatures() được gọi từ dữ liệu /api/license khi đăng nhập.
 */
import { ref } from 'vue';

const features = ref<Set<string>>(new Set());

export function setFeatures(list: string[]): void {
  features.value = new Set(list);
}

export function useLicense() {
  return {
    has: (feature: string): boolean => features.value.has(feature),
  };
}
