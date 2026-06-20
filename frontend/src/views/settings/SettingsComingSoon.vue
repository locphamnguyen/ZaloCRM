<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="coming-soon">
    <div class="cs-icon">{{ icon }}</div>
    <h2 class="cs-title">{{ title }}</h2>
    <p class="cs-desc">{{ description }}</p>
    <div class="cs-tag">🔒 Sắp ra mắt</div>

    <div v-if="bullets.length > 0" class="cs-roadmap">
      <div class="cs-roadmap-label">Tính năng dự kiến:</div>
      <ul>
        <li v-for="b in bullets" :key="b">{{ b }}</li>
      </ul>
    </div>

    <div class="cs-actions">
      <RouterLink to="/settings" class="cs-link">← Về Cài đặt</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  feature: string;
}>();

interface FeatureMeta {
  icon: string;
  title: string;
  description: string;
  bullets: string[];
}

const FEATURE_META: Record<string, FeatureMeta> = {
  notifications: {
    icon: '🔔',
    title: 'Thông báo',
    description: 'Tuỳ chỉnh thông báo in-app, âm thanh, push notification cho mọi sự kiện CRM.',
    bullets: [
      'Bật/tắt thông báo cho từng loại sự kiện (tin nhắn mới, lịch hẹn, lead score cao...)',
      'Âm thanh notification tuỳ chỉnh',
      'Quiet hours (giờ không làm phiền)',
      'Browser push notification',
    ],
  },
  theme: {
    icon: '🎨',
    title: 'Giao diện',
    description: 'Chọn theme sáng/tối, mật độ hiển thị, font chữ.',
    bullets: [
      'Light / Dark / Auto theme',
      'Mật độ: Compact / Comfortable / Spacious',
      'Font size 12-16px',
      'Color accent tuỳ chỉnh',
    ],
  },
  sessions: {
    icon: '📱',
    title: 'Phiên đăng nhập',
    description: 'Xem các thiết bị đang đăng nhập tài khoản của bạn.',
    bullets: [
      'Danh sách thiết bị + IP + last active',
      'Đăng xuất từ xa',
      'Cảnh báo đăng nhập bất thường',
    ],
  },
  billing: {
    icon: '💳',
    title: 'Gói cước & Billing',
    description: 'Quản lý subscription, payment method, invoice history.',
    bullets: [
      'Upgrade/downgrade gói',
      'Payment method',
      'Invoice history + export PDF',
      'Usage limits + alert khi gần hạn',
    ],
  },
  audit: {
    icon: '📜',
    title: 'Audit log',
    description: 'Lịch sử thao tác trong tổ chức — ai đã thay đổi gì, khi nào.',
    bullets: [
      'Filter theo user / loại action / thời gian',
      'Export CSV',
      'Retention 90 ngày (gói cao hơn 1 năm)',
      'Real-time stream khi có thay đổi',
    ],
  },
  stuck: {
    icon: '⏸',
    title: 'Stuck detection rule',
    description: 'Cấu hình khi nào khách hàng bị flag "stuck" (im lặng quá lâu).',
    bullets: [
      'Threshold: 3d / 7d / 14d / 30d',
      'Loại tin nhắn tính (inbound / outbound)',
      'Exclude tag (vd "Hot lead" không bao giờ stuck)',
      'Notification cho sale khi KH stuck',
    ],
  },
  folders: {
    icon: '📁',
    title: 'Folder mặc định',
    description: 'Cấu hình folder mặc định cho nick mới + auto-assign rules.',
    bullets: [
      'Default folder khi thêm nick mới',
      'Auto-assign theo source (form / OA / manual)',
      'Folder color + icon',
      'Quota nick per folder',
    ],
  },
  templates: {
    icon: '📝',
    title: 'Template tin nhắn',
    description: 'Quản lý template tin nhắn nhanh + variable substitution.',
    bullets: [
      'Library template chia category',
      'Variable {{name}}, {{company}}, {{last_order}}...',
      'Approval workflow cho template marketing',
      'Performance metrics (open/reply rate)',
    ],
  },
  'rate-limit': {
    icon: '⏱',
    title: 'Rate limit per nick',
    description: 'Cấu hình quota tin nhắn/ngày, friend-add/ngày cho mỗi nick.',
    bullets: [
      'Default 300 msg/day, 30-50 friend-add/day',
      'Override per nick',
      'Delay 15-45 phút giữa actions automation',
      'Hour 6-22 (không gửi đêm khuya)',
    ],
  },
  automation: {
    icon: '🤖',
    title: 'Automation rules',
    description: 'Phase 7+ — engine kết bạn tự động, gửi tin chào mừng, follow-up.',
    bullets: [
      'Trigger: KH mới / sinh nhật / stuck / form submission',
      'Action: send template / gắn tag / assign sale',
      'Per-nick throttle gate cross-campaign',
      'A/B test message variants',
    ],
  },
  'public-token': {
    icon: '🎫',
    title: 'Public API token',
    description: 'Tạo token truy cập API public cho integration bên thứ 3.',
    bullets: [
      'Scoped tokens (read-only / write / admin)',
      'IP whitelist',
      'Rate limit per token',
      'Revoke + rotate',
    ],
  },
  'feature-flags': {
    icon: '🚩',
    title: 'Feature flags',
    description: 'Bật/tắt tính năng beta cho tổ chức.',
    bullets: [
      'Beta features (vd: AI suggest reply, sentiment analysis)',
      'A/B rollout %',
      'Per-user override',
      'Kill switch cho production issue',
    ],
  },
  backup: {
    icon: '💾',
    title: 'Backup & Restore',
    description: 'Backup database, export toàn bộ data tổ chức.',
    bullets: [
      'Auto daily backup',
      'Manual snapshot',
      'Export full data (Conversation + Contact + Tag)',
      'GDPR data deletion request',
    ],
  },
};

const meta = computed<FeatureMeta>(() => FEATURE_META[props.feature] || {
  icon: '🚧',
  title: 'Đang phát triển',
  description: 'Tính năng này đang được phát triển và sẽ ra mắt sớm.',
  bullets: [],
});

const icon = computed(() => meta.value.icon);
const title = computed(() => meta.value.title);
const description = computed(() => meta.value.description);
const bullets = computed(() => meta.value.bullets);
</script>

<style scoped>
.coming-soon {
  max-width: 560px;
  margin: 40px auto;
  background: white;
  border-radius: 12px;
  border: 1px solid #E4E5E9;
  padding: 40px 32px;
  text-align: center;
  font-family: inherit;
}
.cs-icon {
  font-size: 56px;
  margin-bottom: 16px;
  opacity: 0.85;
}
.cs-title {
  font-size: 22px;
  font-weight: 700;
  color: #1F2D3D;
  margin: 0 0 8px;
}
.cs-desc {
  font-size: 13.5px;
  color: #6B7785;
  margin: 0 0 16px;
  line-height: 1.55;
}
.cs-tag {
  display: inline-block;
  padding: 4px 12px;
  background: linear-gradient(135deg, #EEF0FF 0%, #F4F4FE 100%);
  border: 1px solid rgba(94, 106, 210, 0.3);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #5E6AD2;
  margin-bottom: 24px;
}
.cs-roadmap {
  text-align: left;
  background: #FAFAFC;
  border: 1px solid #E4E5E9;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.cs-roadmap-label {
  font-size: 11px;
  font-weight: 700;
  color: #6B7785;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}
.cs-roadmap ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.cs-roadmap li {
  padding: 4px 0 4px 22px;
  position: relative;
  font-size: 12.5px;
  color: #1F2D3D;
  line-height: 1.55;
}
.cs-roadmap li::before {
  content: '✓';
  position: absolute;
  left: 0;
  top: 4px;
  color: #5E6AD2;
  font-weight: 700;
}
.cs-actions {
  margin-top: 8px;
}
.cs-link {
  display: inline-block;
  font-size: 12.5px;
  color: #5E6AD2;
  text-decoration: none;
  font-weight: 600;
}
.cs-link:hover { text-decoration: underline; }
</style>
