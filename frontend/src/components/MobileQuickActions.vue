<template>
  <div style="position: fixed; bottom: 80px; right: 16px; z-index: 50;">
    <v-menu location="top" :close-on-content-click="true">
      <template #activator="{ props }">
        <v-btn icon color="primary" size="large" v-bind="props" elevation="4">
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
