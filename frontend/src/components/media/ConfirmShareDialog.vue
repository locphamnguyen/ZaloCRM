<template>
  <div class="cs-overlay" @click.self="$emit('cancel')">
    <div class="cs-box">
      <div class="cs-ic">⚠️</div>
      <h3 class="cs-ttl">Chia sẻ ảnh từ nick Riêng tư?</h3>
      <p class="cs-msg">
        Ảnh này được lưu từ một nick Riêng tư và <b>có thể chứa thông tin khách hàng</b>.
        Khi chuyển sang Công khai, mọi người trong tổ chức sẽ xem được. Chắc chắn chia sẻ?
      </p>
      <div class="cs-acts">
        <button class="cs-cancel" @click="$emit('cancel')">Giữ Riêng tư</button>
        <button class="cs-ok" @click="$emit('confirm')">Vẫn chia sẻ Công khai</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits<{ cancel: []; confirm: [] }>();
</script>

<style scoped>
.cs-overlay { position:fixed; inset:0; z-index:120; background:rgba(15,23,42,.32); display:flex; align-items:center; justify-content:center; }
.cs-box {
  --ink:#181d26; --muted:#41454d; --hairline:#dddddd; --coral:#aa2d00;
  width:380px; max-width:92vw; background:#fff; border:1px solid var(--hairline); border-radius:12px;
  padding:22px 24px; box-shadow:0 16px 48px rgba(15,23,42,.22); text-align:center;
}
.cs-ic { font-size:34px; margin-bottom:8px; }
.cs-ttl { font-size:16px; color:var(--ink); margin:0 0 8px; font-weight:600; }
.cs-msg { font-size:13.5px; color:var(--muted); line-height:1.55; margin:0 0 18px; text-align:left; }
.cs-acts { display:flex; gap:10px; }
.cs-cancel { flex:1; border:1px solid var(--hairline); background:#fff; color:var(--ink); border-radius:8px; padding:10px; font-size:13px; font-weight:500; cursor:pointer; }
.cs-ok { flex:1; border:1px solid #f0c4b3; background:#fbe9e2; color:var(--coral); border-radius:8px; padding:10px; font-size:13px; font-weight:600; cursor:pointer; }
</style>
