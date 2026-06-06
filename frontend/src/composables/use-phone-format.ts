/**
 * use-phone-format.ts — Hiển thị SĐT đẹp cho UI (KHÔNG đổi giá trị lưu).
 *
 * DB lưu canonical '84xxx' (xem backend/src/shared/utils/phone.ts). UI cần hiển thị
 * thân thiện: '0359 944 488' (nội địa) + tooltip '+84 359 944 488' (quốc tế).
 *
 * Quy ước khớp backend phoneVariants(): 84xxx → 0xxx (bỏ 84 thêm 0) hoặc +84xxx.
 * Chỉ format VN mobile 10 số (sau khi về 0xxx, prefix [35789]); số bàn/quốc tế/rác
 * trả NGUYÊN BẢN để không làm hỏng (Anh chốt 2026-06-06: 0xxx chính + tooltip +84).
 */

const VN_MOBILE = /^0[35789]\d{8}$/;

/** Đưa input bất kỳ về dạng '0xxxxxxxxx' nếu là VN mobile, ngược lại null. */
function toLocal(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return null;
  let local: string;
  if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) {
    local = '0' + digits.slice(2);
  } else if (digits.startsWith('0') && (digits.length === 10 || digits.length === 11)) {
    local = digits;
  } else if (digits.length === 9) {
    // 9 số thiếu 0 đầu (vd 359944488)
    local = '0' + digits;
  } else {
    return null;
  }
  return VN_MOBILE.test(local) ? local : null;
}

/**
 * Hiển thị nội địa: '0359 944 488' (0 + nhóm 3-3-3). Nếu không phải VN mobile →
 * trả nguyên bản (đã trim). Dùng cho text hiển thị chính.
 */
export function displayPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const local = toLocal(raw);
  if (!local) return String(raw).trim();
  // 0XXX XXX XXX — nhóm sau số 0: 3-3-3
  const body = local.slice(1); // 9 số
  return `0${body.slice(0, 3)} ${body.slice(3, 6)} ${body.slice(6, 9)}`;
}

/**
 * Hiển thị quốc tế: '+84 359 944 488'. Dùng cho tooltip. Nếu không phải VN mobile →
 * trả nguyên bản.
 */
export function displayPhoneIntl(raw: string | null | undefined): string {
  if (!raw) return '';
  const local = toLocal(raw);
  if (!local) return String(raw).trim();
  const body = local.slice(1); // 9 số (bỏ 0)
  return `+84 ${body.slice(0, 3)} ${body.slice(3, 6)} ${body.slice(6, 9)}`;
}

export function usePhoneFormat() {
  return { displayPhone, displayPhoneIntl };
}
