// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * stores/privacy.ts — Pinia store cho Phase Riêng Tư (OTP-only 2026-06-06).
 *
 * Anh chốt 2026-06-06: bỏ PIN, unlock qua OTP gửi Zalo nick nội bộ.
 * State: isUnlocked (qua activeSessionCount), expiresAt, activeSessions.
 * Cookie management: HttpOnly nên frontend KHÔNG đọc/ghi cookie. Status từ API.
 */
import { defineStore } from 'pinia';
import { api } from '@/api/index';

export interface PrivacyStatus {
  hasPin: boolean;
  lockedUntil: string | null;
  activeSessionCount: number;
  // Phase Privacy v2 2026-05-23: ipAddress raw cho user thấy device session của mình.
  activeSessions: Array<{
    id: string;
    expiresAt: string;
    userAgent: string | null;
    ipAddress: string | null;
    unlockedAt: string;
  }>;
}

export interface OtpStatus {
  /** User có internal contact ready để nhận OTP không */
  canRequestOtp: boolean;
  /** Lý do nếu canRequestOtp=false */
  blockedReason: 'no_internal_contact' | 'locked' | null;
  /** Còn bao lâu mới hết lock (ISO string) */
  lockedUntil: string | null;
  /** 2026-06-11: user đã đặt ≥1 nick Riêng tư chưa (rule badge). */
  hasPrivateNick?: boolean;
  /** Nick nhận OTP (Zalo chính của user): SĐT liên lạc nội bộ + tên nick nội bộ. */
  internalContact?: { phone: string | null; nickName: string | null } | null;
}

export interface RequestOtpResult {
  tokenId: string;
  expiresAt: string;
  retryAfterSeconds?: number;
}

export const usePrivacyStore = defineStore('privacy', {
  state: () => ({
    hasPin: false,
    lockedUntil: null as string | null,
    activeSessionCount: 0,
    activeSessions: [] as PrivacyStatus['activeSessions'],
    loading: false,
    lastChecked: 0,
  }),
  getters: {
    isUnlocked: (state) => state.activeSessionCount > 0,
    remainingMinutes: (state) => {
      if (state.activeSessions.length === 0) return 0;
      const exp = new Date(state.activeSessions[0].expiresAt).getTime();
      return Math.max(0, Math.floor((exp - Date.now()) / 60000));
    },
  },
  actions: {
    async fetchStatus(force = false) {
      // Cache 30s
      if (!force && Date.now() - this.lastChecked < 30000) return;
      this.loading = true;
      try {
        const { data } = await api.get<PrivacyStatus>('/privacy/status');
        this.hasPin = data.hasPin;
        this.lockedUntil = data.lockedUntil;
        this.activeSessionCount = data.activeSessionCount;
        this.activeSessions = data.activeSessions;
        this.lastChecked = Date.now();
      } finally {
        this.loading = false;
      }
    },
    async lock() {
      try {
        await api.post('/privacy/lock');
      } catch { /* best effort */ }
      await this.fetchStatus(true);
    },
    async flipNickPrivacyMode(zaloAccountId: string, mode: 'main' | 'sub') {
      await api.patch(`/zalo-accounts/${zaloAccountId}/privacy-mode`, { mode });
    },

    // ── OTP flow (2026-06-06) ────────────────────────────────────────────
    /** Kiểm user có thể xin OTP không (có internal contact + không đang lock). */
    async fetchOtpStatus(): Promise<OtpStatus> {
      const { data } = await api.get<OtpStatus>('/privacy/otp/status');
      return data;
    },
    /** Sinh + gửi OTP 4 số qua Zalo nick nội bộ. context nêu rõ hành động gạt nick. */
    async requestOtp(
      durationMinutes: 5 | 15 | 480 | 720,
      context?: { action: 'enable' | 'disable' | 'unlock'; nickName?: string; nickId?: string },
    ): Promise<RequestOtpResult> {
      const { data } = await api.post<RequestOtpResult>('/privacy/otp/request', { durationMinutes, context });
      return data;
    },
    /**
     * Verify OTP. 2 kết quả:
     *  - action='unlock': server set cookie session → có expiresAt/durationMinutes, fetchStatus refresh.
     *  - action='enable'/'disable': chỉ xác nhận mã (gạt nick) → KHÔNG session, không cần fetchStatus.
     */
    async verifyOtp(
      tokenId: string,
      code: string,
    ): Promise<{ ok: boolean; action: 'enable' | 'disable' | 'unlock'; expiresAt?: string; durationMinutes?: number }> {
      const { data } = await api.post<{
        ok: boolean;
        action: 'enable' | 'disable' | 'unlock';
        expiresAt?: string;
        durationMinutes?: number;
      }>('/privacy/otp/verify', { tokenId, code });
      // Chỉ refresh status khi thực sự mở phiên (unlock) — gạt không đổi session.
      if (data.action === 'unlock') await this.fetchStatus(true);
      return data;
    },
  },
});
