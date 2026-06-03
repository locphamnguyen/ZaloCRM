/**
 * Capability 'zalo.messaging' — impl của CORE.
 *
 * Bọc zaloPool (đã có) thành 1 contract ổn định để EE gửi tin Zalo mà KHÔNG
 * phải thò tay vào internal zaloPool.getApi(). Internal đổi → chỉ sửa file này,
 * EE không bị ảnh hưởng.
 */
import { zaloPool } from '../modules/zalo/zalo-pool.js';
import type { ZaloMessagingCapability } from '../plugin-api/index.js';

export const zaloMessagingImpl: ZaloMessagingCapability = {
  async sendText(accountId, toUid, text) {
    const api = zaloPool.getApi(accountId);
    if (!api) {
      throw new Error(`[zalo.messaging] account ${accountId} not connected`);
    }
    await api.sendMessage({ msg: text }, toUid);
  },

  isConnected(accountId) {
    return zaloPool.getStatus(accountId) === 'connected';
  },
};
