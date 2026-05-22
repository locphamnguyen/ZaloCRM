import { computed, ref } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

type PushStatus = 'checking' | 'unsupported' | 'unavailable' | 'default' | 'denied' | 'subscribed' | 'unsubscribed';

interface PushConfigResponse {
  enabled: boolean;
  publicKey: string;
}

const status = ref<PushStatus>('checking');
const publicKey = ref('');
const busy = ref(false);
const initialized = ref(false);

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function browserSupportsPush() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && window.isSecureContext;
}

async function syncLocalSubscriptionState() {
  if (!browserSupportsPush()) {
    status.value = 'unsupported';
    return;
  }
  if (!publicKey.value) {
    status.value = 'unavailable';
    return;
  }
  if (Notification.permission === 'denied') {
    status.value = 'denied';
    return;
  }
  if (Notification.permission === 'default') {
    status.value = 'default';
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  status.value = subscription ? 'subscribed' : 'unsubscribed';
}

export function useWebPush() {
  const toast = useToast();
  const canEnable = computed(() => ['default', 'unsubscribed'].includes(status.value) && !busy.value);
  const isSubscribed = computed(() => status.value === 'subscribed');

  async function init() {
    if (initialized.value) return;
    initialized.value = true;
    if (!browserSupportsPush()) {
      status.value = 'unsupported';
      return;
    }

    try {
      const { data } = await api.get<PushConfigResponse>('/notifications/push/config');
      publicKey.value = data.enabled ? data.publicKey : '';
      await syncLocalSubscriptionState();
    } catch {
      status.value = 'unavailable';
    }
  }

  async function enable() {
    busy.value = true;
    try {
      await init();
      if (!publicKey.value) {
        status.value = 'unavailable';
        toast.warning('Web Push chưa được cấu hình trên máy chủ', 5000);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        status.value = 'denied';
        toast.error('Trình duyệt đang chặn thông báo cho ZaloCRM', 5000);
        return;
      }
      if (permission !== 'granted') {
        status.value = 'default';
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey.value),
      });

      await api.post('/notifications/push/subscriptions', subscription.toJSON());
      status.value = 'subscribed';
      toast.success('Đã bật thông báo Web/PWA');
    } catch {
      status.value = 'unavailable';
      toast.error('Không thể bật thông báo lúc này', 5000);
    } finally {
      busy.value = false;
    }
  }

  async function disable() {
    busy.value = true;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.delete('/notifications/push/subscriptions', { data: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      status.value = Notification.permission === 'granted' ? 'unsubscribed' : Notification.permission;
      toast.success('Đã tắt thông báo trên thiết bị này');
    } catch {
      toast.error('Không thể tắt thông báo lúc này', 5000);
    } finally {
      busy.value = false;
    }
  }

  async function sendTest() {
    busy.value = true;
    try {
      await api.post('/notifications/push/test');
      toast.success('Đã gửi thông báo thử');
    } catch {
      toast.error('Không gửi được thông báo thử', 5000);
    } finally {
      busy.value = false;
    }
  }

  return { status, busy, canEnable, isSubscribed, init, enable, disable, sendTest };
}
