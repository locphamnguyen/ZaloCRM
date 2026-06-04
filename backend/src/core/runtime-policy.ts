/**
 * runtime-policy.ts — cầu nối để background worker (không có `app`/`ctx`) gọi
 * PolicyRegistry.check. build-context set instance đang hoạt động; trước khi set
 * (boot sớm) hoặc bản community chưa ai register → check trả TRUE (cho qua).
 *
 * Giữ nguyên tắc một chiều: worker core gọi checkPolicy; EE chỉ register qua ctx.policy
 * (cùng instance được set vào đây). Không import gì từ Enterprise.
 */
import type { PolicyRegistry } from '../plugin-api/index.js';

type PolicyArgs = { req: unknown; resourceId?: string; [key: string]: unknown };

let active: PolicyRegistry | null = null;

export function setRuntimePolicy(p: PolicyRegistry): void {
  active = p;
}

/** Trả TRUE nếu chưa có registry hoặc chưa ai register policy → không khóa. */
export async function checkPolicy(name: string, args: PolicyArgs): Promise<boolean> {
  return active ? active.check(name, args) : true;
}
