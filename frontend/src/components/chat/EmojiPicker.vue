<template>
  <v-menu
    v-model="open"
    :close-on-content-click="false"
    open-on-hover
    :open-delay="120"
    :close-delay="200"
    location="top"
  >
    <template #activator="{ props: act }">
      <button class="icon-tool emoji-trigger" v-bind="act" title="Emoji"><SmileIcon :size="18" :stroke-width="1.5" /></button>
    </template>
    <v-card class="emoji-card pa-2">
      <!-- Category tabs -->
      <div class="emoji-tabs">
        <button
          v-for="cat in CATEGORIES"
          :key="cat.id"
          class="emoji-tab"
          :class="{ active: activeCat === cat.id }"
          :title="cat.label"
          @click="activeCat = cat.id"
        >{{ cat.icon }}</button>
      </div>
      <!-- Emoji grid -->
      <div class="emoji-grid">
        <button
          v-for="e in currentEmojis"
          :key="e"
          class="emoji-cell"
          :title="e"
          @click="onPick(e)"
        >{{ e }}</button>
      </div>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Smile as SmileIcon } from 'lucide-vue-next';

const emit = defineEmits<{ pick: [emoji: string] }>();

const open = ref(false);

const CATEGORIES = [
  { id: 'smileys', icon: '😊', label: 'Mặt cười' },
  { id: 'gestures', icon: '👍', label: 'Cử chỉ' },
  { id: 'love',     icon: '❤️', label: 'Yêu thương' },
  { id: 'objects',  icon: '🎉', label: 'Vật dụng' },
  { id: 'food',     icon: '🍻', label: 'Ăn uống' },
  { id: 'symbols',  icon: '✨', label: 'Biểu tượng' },
] as const;

const EMOJIS: Record<string, string[]> = {
  smileys: '😊 😂 😍 🥰 😘 🤩 😎 🤔 😏 😴 🙄 😬 😢 😭 😤 😡 😱 🤯 🥺 😇 😋 😜 🤪 🤗 🤭 🫢 😶 🙃 😉 😌 😔 😪 😮‍💨 🤤 😵‍💫 😵'.split(' '),
  gestures: '👍 👎 👌 🤌 ✌️ 🤞 🤝 👏 🙏 🤲 💪 🙌 🤙 👋 🤚 ✋ 🖐️ 🖖 🤘 🤟 ✊ 👊 🫶 🫰 🤛 🤜 ☝️ 👇 👈 👉 🫵 🤏'.split(' '),
  love: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💌 💋 🌹 🌷 🌸 🌺 🌻 🌼 💐 💍 💎 👑 🥀 ❤️‍🔥'.split(' '),
  objects: '🎉 🎊 🎁 🎈 🎂 🎀 🪅 🎆 🎇 🧨 ✨ 🎄 🎃 🪄 🎯 🎭 🏆 🥇 🥈 🥉 🏅 🎖 🎫 🎟 🎼 🎵 🎶 📢 📣 🔔 🔕 📞'.split(' '),
  food: '🍻 🍺 🥂 🍷 🍸 🍹 🥃 🍾 ☕ 🍵 🍶 🥛 🧃 🧋 🍼 🥤 🍕 🍔 🌭 🍟 🥗 🍝 🍜 🍣 🍱 🍙 🍤 🍰 🎂 🍩 🍪 🍫'.split(' '),
  symbols: '✨ ⭐ 🌟 💯 🔥 ⚡ 💥 💫 ⏰ ⌚ 📅 📆 ✅ ☑️ ❌ ⛔ 🚫 ⚠️ ❗ ❓ 💡 🔆 🌈 ☀️ ⛅ 🌧 ⛈ 🌙 🌝 🌚 🌟 💤'.split(' '),
};

const activeCat = ref<string>('smileys');
const currentEmojis = computed(() => EMOJIS[activeCat.value] || []);

function onPick(e: string) {
  emit('pick', e);
  // Không tự đóng — sale có thể chọn nhiều emoji liên tiếp
}
</script>

<style scoped>
.icon-tool {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  color: var(--smax-grey-700);
  background: transparent; border: none;
  font-family: inherit;
}
.icon-tool:hover { background: var(--smax-grey-100); }

.emoji-card {
  width: 320px;
  max-height: 320px;
  display: flex; flex-direction: column;
}
.emoji-tabs {
  display: flex; gap: 2px;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--smax-grey-200);
  flex-shrink: 0;
}
.emoji-tab {
  flex: 1;
  background: transparent; border: none;
  padding: 5px;
  cursor: pointer;
  font-size: 18px;
  border-radius: 6px;
  font-family: inherit;
}
.emoji-tab:hover { background: var(--smax-grey-100); }
.emoji-tab.active { background: var(--smax-primary-soft); }

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  overflow-y: auto;
  flex: 1;
}
.emoji-cell {
  width: 100%; aspect-ratio: 1;
  background: transparent; border: none;
  font-size: 19px;
  cursor: pointer;
  border-radius: 5px;
  font-family: inherit;
  padding: 0;
}
.emoji-cell:hover {
  background: var(--smax-grey-100);
  transform: scale(1.15);
  transition: transform 0.1s;
}
</style>
