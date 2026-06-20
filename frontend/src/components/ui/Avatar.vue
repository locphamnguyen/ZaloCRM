<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div
    class="smax-av"
    :class="{ 'is-group': isGroup }"
    :style="containerStyle"
    :title="title || name || ''"
  >
    <!-- Image with fallback to initials on error -->
    <img
      v-if="src && !imgError"
      :src="src"
      :alt="name || 'avatar'"
      class="av-img"
      loading="lazy"
      decoding="async"
      @error="imgError = true"
    />
    <span v-else class="av-initials" :style="initialsStyle">{{ initials }}</span>

    <!-- Group sticker (góc phải trên) — Material Design "group" icon, clean ở size nhỏ -->
    <span
      v-if="isGroup"
      class="av-group-sticker"
      :style="stickerStyle"
      aria-label="Nhóm hội thoại"
    >
      <svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
      </svg>
    </span>

    <!-- Group member count badge (optional) -->
    <span v-if="isGroup && groupMembersCount" class="av-members" :style="membersBadgeStyle">
      {{ groupMembersCount > 99 ? '99+' : groupMembersCount }}
    </span>

    <!-- Gender badge (chỉ cho user thread, không group) -->
    <span
      v-if="!isGroup && gender && (gender === 'male' || gender === 'female')"
      class="av-gender"
      :class="gender === 'female' ? 'gender-female' : 'gender-male'"
      :style="genderBadgeStyle"
    >
      {{ gender === 'female' ? '♀' : '♂' }}
    </span>

    <!-- Platform mark (Z badge cho Zalo) -->
    <span
      v-if="!isGroup && platform === 'zalo'"
      class="av-platform"
      :style="platformBadgeStyle"
    >Z</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = withDefaults(defineProps<{
  src?: string | null;
  name?: string;
  size?: number;
  isGroup?: boolean;
  groupMembersCount?: number | null;
  gender?: string | null;
  platform?: 'zalo' | null;
  /** String dùng để hash ra gradient màu khi không có src (mặc định = name) */
  gradientSeed?: string;
  /** Title HTML tooltip */
  title?: string;
}>(), {
  size: 36,
  isGroup: false,
  groupMembersCount: null,
  gender: null,
  platform: null,
  gradientSeed: '',
  title: '',
});

const imgError = ref(false);

// Reset imgError khi src đổi
watch(() => props.src, () => { imgError.value = false; });

const initials = computed(() => {
  const name = (props.name || '?').trim();
  if (props.isGroup) {
    const first = name.split(/\s+/)[0] || 'G';
    return first.slice(0, 2).toUpperCase();
  }
  const parts = name.split(/\s+/);
  return ((parts[parts.length - 1]?.[0] || '?').toUpperCase()
    + (parts.length > 1 ? (parts[parts.length - 2]?.[0] || '').toUpperCase() : ''));
});

// 6 gradient palettes — pick by hash of seed
const GRADIENTS = [
  'linear-gradient(135deg,#90caf9,#1976d2)',
  'linear-gradient(135deg,#ff7043,#bf360c)',
  'linear-gradient(135deg,#ce93d8,#7b1fa2)',
  'linear-gradient(135deg,#80cbc4,#00695c)',
  'linear-gradient(135deg,#fbc02d,#f57c00)',
  'linear-gradient(135deg,#f48fb1,#c2185b)',
];
const GROUP_GRADIENT = 'linear-gradient(135deg,#ff7043,#d84315)';

const gradient = computed(() => {
  if (props.isGroup) return GROUP_GRADIENT;
  const seed = props.gradientSeed || props.name || '';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
});

const containerStyle = computed(() => {
  const s = `${props.size}px`;
  return { width: s, height: s };
});
const initialsStyle = computed(() => ({
  background: gradient.value,
  fontSize: `${Math.round(props.size * 0.4)}px`,
}));

const stickerStyle = computed(() => {
  // Tăng 10% so với bản trước (0.34 → 0.374)
  const sz = Math.round(props.size * 0.374);
  // 2/3 sticker DÍNH VÀO trong vòng tròn avatar, 1/3 nhô ra ngoài
  const offset = Math.round(sz * 0.33);
  return {
    width: `${sz}px`,
    height: `${sz}px`,
    top: `-${offset}px`,
    right: `-${offset}px`,
  };
});
const membersBadgeStyle = computed(() => ({
  fontSize: `${Math.max(8, Math.round(props.size * 0.25))}px`,
  minWidth: `${Math.round(props.size * 0.46)}px`,
  height: `${Math.round(props.size * 0.46)}px`,
  lineHeight: `${Math.round(props.size * 0.46)}px`,
}));
const genderBadgeStyle = computed(() => {
  const sz = Math.max(14, Math.round(props.size * 0.4));
  return {
    width: `${sz}px`,
    height: `${sz}px`,
    fontSize: `${Math.round(sz * 0.55)}px`,
  };
});
const platformBadgeStyle = computed(() => {
  const sz = Math.max(13, Math.round(props.size * 0.35));
  return {
    width: `${sz}px`,
    height: `${sz}px`,
    fontSize: `${Math.round(sz * 0.6)}px`,
  };
});
</script>

<style scoped>
.smax-av {
  position: relative;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: visible;
  display: inline-block;
  vertical-align: middle;
}

.av-img {
  width: 100%; height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.av-initials {
  width: 100%; height: 100%;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 600;
  letter-spacing: 0.3px;
  background: linear-gradient(135deg, #90caf9, #1976d2);
}

/* ════════ Group treatment ════════ */
.smax-av.is-group .av-img,
.smax-av.is-group .av-initials {
  /* Vòng viền xanh đậm — đặc trưng cho group */
  outline: 2px solid #0D47A1;
  outline-offset: -1px;
  box-shadow: 0 0 0 1px var(--smax-bg, white);
}

/* Group sticker (góc phải trên) — Material group icon, nền xanh đậm.
   Position: 2/3 outside avatar circle, 1/3 overlapping — set inline qua stickerStyle. */
.av-group-sticker {
  position: absolute;
  background: #0D47A1;
  border-radius: 50%;
  border: 1.5px solid var(--smax-bg, white);
  box-sizing: border-box;
  z-index: 2;
  pointer-events: none;
  display: inline-flex; align-items: center; justify-content: center;
  overflow: hidden;
  padding: 0;
}
.av-group-sticker svg {
  width: 78%; height: 78%;
  display: block;
}

/* Member count badge (dưới sticker) */
.av-members {
  position: absolute;
  bottom: -3px; right: -3px;
  background: var(--smax-primary, #2962ff);
  color: white;
  border-radius: 999px;
  font-weight: 700;
  text-align: center;
  border: 2px solid var(--smax-bg, white);
  padding: 0 4px;
  box-sizing: content-box;
  z-index: 2;
  pointer-events: none;
}

/* Gender badge (chỉ user thread) */
.av-gender {
  position: absolute;
  bottom: -2px; right: -3px;
  border-radius: 50%;
  border: 2.5px solid var(--smax-bg, white);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700;
  z-index: 2;
}
.gender-female { background: var(--smax-female, #e91e63); }
.gender-male   { background: var(--smax-male, #1e88e5); }

/* Platform mark Z (Zalo) — chỉ user thread khi không có gender */
.av-platform {
  position: absolute;
  bottom: -2px; right: -2px;
  background: #0068ff;
  color: white;
  border-radius: 50%;
  border: 2px solid var(--smax-bg, white);
  font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  z-index: 1;
}

/* Khi có cả gender + platform: ẩn platform (gender ưu tiên) */
.smax-av:has(.av-gender) .av-platform { display: none; }
</style>
