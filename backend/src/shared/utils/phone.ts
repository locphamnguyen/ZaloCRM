/**
 * phone.ts — Canonical SĐT normalization cho VN.
 *
 * Tại sao: VN có 3+ format cùng số: 0xxx (local), 84xxx (intl), +84xxx (e164).
 * DB lưu `phoneNormalized` canonical (84xxx no leading + no spaces) + index để:
 *   - Dedup chính xác (cùng SĐT chỉ 1 row, bất kể user nhập format gì)
 *   - Search exact match indexed O(log n) thay vì OR contains O(n)
 *   - Cross-system compare ổn định
 *
 * Rule:
 *   - Trim, strip non-digit (giữ + tạm thời để detect intl)
 *   - + có hoặc không → strip
 *   - Bắt đầu 0 + 9-10 digit → strip 0, prepend 84 → 84xxx
 *   - Bắt đầu 84 + 9-10 digit (10-12 total) → giữ
 *   - Bắt đầu 9-10 digit không prefix → assume local, prepend 84
 *   - Khác (quốc tế ngoài VN, length lạ) → giữ raw digits làm best-effort
 *   - Length < 9 hoặc > 13 → return null (invalid)
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Strip mọi ký tự không phải digit
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 9 || digits.length > 13) return null;

  // VN 0xxx (10 digit total): 0 → 84
  if (digits.startsWith('0') && (digits.length === 10 || digits.length === 11)) {
    return '84' + digits.slice(1);
  }
  // VN 84xxx (11-12 digit): keep
  if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) {
    return digits;
  }
  // Mobile-only 9 digit (vd 936668266): assume VN, prepend 84
  if (digits.length === 9) return '84' + digits;
  // Other country / unknown: keep digits as-is (best effort)
  return digits;
}

/**
 * Sinh các variant phổ biến từ canonical 84xxx để hiển thị / cross-check.
 * Ít dùng — chủ yếu cho hiển thị fallback hoặc legacy matching.
 */
export function phoneVariants(input: string | null | undefined): string[] {
  const canon = normalizePhone(input);
  if (!canon) return [];
  const variants = new Set<string>([canon]);
  if (canon.startsWith('84')) {
    variants.add('+' + canon);            // +84xxx
    variants.add('0' + canon.slice(2));   // 0xxx
  }
  return [...variants];
}
