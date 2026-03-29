import { ref, onMounted, onUnmounted } from 'vue';

const MOBILE_BREAKPOINT = 768;

const isMobile = ref(false);
const isOnline = ref(true);

let initialized = false;

function updateMobile() {
  isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
}

function updateOnline() {
  isOnline.value = navigator.onLine;
}

export function useMobile() {
  if (!initialized) {
    initialized = true;
    if (typeof window !== 'undefined') {
      updateMobile();
      updateOnline();
      window.addEventListener('resize', updateMobile);
      window.addEventListener('online', updateOnline);
      window.addEventListener('offline', updateOnline);
    }
  }

  return { isMobile, isOnline };
}
