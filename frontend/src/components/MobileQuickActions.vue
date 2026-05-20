<template>
  <div class="mobile-quick-actions">
    <v-menu location="top" :close-on-content-click="true">
      <template #activator="{ props }">
        <v-btn icon color="primary" size="large" v-bind="props" elevation="4" class="golden-fab">
          <v-icon>mdi-plus</v-icon>
        </v-btn>
      </template>
      <v-list density="compact" rounded="xl">
        <v-list-item prepend-icon="mdi-account-plus" title="Thêm khách hàng" @click="$router.push('/contacts')" />
        <v-list-item prepend-icon="mdi-message-plus" title="Tin nhắn mới" @click="$router.push('/chat')" />
      </v-list>
    </v-menu>
  </div>
</template>


<style scoped>
.mobile-quick-actions {
  position: fixed;
  bottom: calc(80px + env(safe-area-inset-bottom));
  right: 16px;
  z-index: 50;
}

.golden-fab {
  background: linear-gradient(135deg, var(--gold-primary), var(--gold-primary-hover)) !important;
  color: #070a12 !important;
}
</style>
