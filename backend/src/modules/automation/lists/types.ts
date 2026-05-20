/**
 * automation/lists/types.ts — Type definitions cho Tệp khách hàng (CustomerList).
 */

export type ListSourceType = 'paste' | 'csv' | 'excel' | 'api';

export type ListStatus = 'processing' | 'done' | 'archived';

export type EntryStatus =
  | 'pending'         // mới insert, chưa validate
  | 'validated'       // phone hợp lệ, chưa biết Zalo
  | 'invalid'         // phone sai format
  | 'dup_in_list'     // trùng entry khác trong CÙNG list
  | 'dup_cross_list'  // trùng entry trong list KHÁC
  | 'dup_with_crm'    // trùng Contact hiện có trong CRM
  | 'contact_created' // đã tạo Contact mới
  | 'enriched';       // đã lookup UID Zalo (hasZalo true/false)

export type InvalidReason =
  | 'too_short'      // < 9 digit
  | 'too_long'       // > 13 digit
  | 'invalid_format' // không phải số
  | 'invalid_prefix' // 0 ko phải số đầu hoặc 84 sai
  | 'empty';

/**
 * Parsed single line từ raw paste textarea.
 * Trim, strip ghi chú, extract phone candidate + name candidate.
 */
export interface ParsedLine {
  rowIndex: number;
  phoneRaw: string;         // gốc dòng paste
  phoneE164: string | null; // "+84908123456" hoặc null nếu invalid
  phoneLocal: string | null;// "0908123456" hoặc null
  nameRaw: string | null;   // tên cắt ra từ dòng (sau số phone)
  personalNote: string | null; // lời mời / tin nhắn riêng — chỉ có cho CSV/Excel mapping
  valid: boolean;
  invalidReason: InvalidReason | null;
}

/**
 * 1 row sau khi user map cột bên frontend (CSV/Excel path).
 * Backend KHÔNG re-parse cell — chỉ validate phone, name+personalNote nhận thẳng.
 */
export interface MappedRow {
  phone: string;          // raw cell value, có thể có prefix "p:" hoặc khoảng trắng
  name?: string | null;
  personalNote?: string | null;
}

export interface ImportResult {
  total: number;
  valid: number;
  invalid: number;
  dupInList: number; // trùng nội bộ trong cùng paste này
  parsedLines: ParsedLine[];
}
