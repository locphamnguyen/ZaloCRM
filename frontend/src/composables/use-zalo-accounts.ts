// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Composable for Zalo account management logic:
 * - CRUD operations via REST API
 * - Real-time QR login flow via Socket.IO
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '@/api/index';
import { Socket } from 'socket.io-client';
import { createAppSocket } from '@/api/socket';

export interface ZaloAccount {
  id: string;
  displayName: string | null;
  avatarUrl?: string | null;
  zaloUid: string | null;
  status: string;
  liveStatus?: string;
  phone: string | null;
  sessionData: any;
  ownerUserId: string;
  // Owner (chủ nick) — backend /zalo-accounts trả kèm. Dùng cho nhóm/lọc theo người dùng.
  owner?: { id: string; fullName: string | null; email: string } | null;
  createdAt: string;
  proxyUrl?: string | null; // masked by backend
  hasProxy?: boolean;
}

// onStatusChange: callback gọi khi nick đổi trạng thái qua socket (connected/disconnected/
// error/reconnect-failed). Dashboard truyền refreshAll để grid card (list enriched) tự cập
// nhật REACTIVE — trước đây chỉ fetchAccounts (list basic) nên grid phải F5 mới thấy đổi.
export function useZaloAccounts(opts?: { onStatusChange?: () => void }) {
  const accounts = ref<ZaloAccount[]>([]);
  const loading = ref(false);
  const adding = ref(false);
  const deleting = ref(false);

  // QR dialog state
  const showQRDialog = ref(false);
  const qrImage = ref('');
  const qrScanned = ref(false);
  const scannedName = ref('');
  const qrError = ref('');
  // FIX #2 2026-06-16: true khi BE dừng sinh QR (phiên treo) → FE hiện nút "Tạo QR mới" fresh.
  const qrSessionDead = ref(false);
  const currentLoginAccountId = ref('');
  // fix ②: nick quét trúng zaloUid đã tồn tại → BE emit 'zalo:duplicate' + dọn record rác.
  const duplicateInfo = ref<{ owner: string | null; message: string } | null>(null);

  let socket: Socket | null = null;

  function statusColor(status: string) {
    switch (status) {
      case 'connected': return 'success';
      case 'qr_pending': case 'connecting': return 'warning';
      default: return 'error';
    }
  }

  function statusText(status: string) {
    switch (status) {
      case 'connected': return 'Đã kết nối';
      case 'qr_pending': return 'Chờ QR';
      case 'connecting': return 'Đang kết nối...';
      default: return 'Ngắt kết nối';
    }
  }

  async function fetchAccounts() {
    loading.value = true;
    try {
      const res = await api.get('/zalo-accounts');
      accounts.value = res.data;
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      loading.value = false;
    }
  }

  // Trả về { ok, reused?, account?, error?, code?, message? } — fix ① cần phân biệt:
  //   • 409 account_owned_by_other → báo nick thuộc người khác (chặn)
  //   • 200 reused (nick của chính mình) → dùng lại record cũ, không tạo mới
  async function addAccount(displayName: string, proxyUrl?: string, phone?: string) {
    adding.value = true;
    try {
      const { data } = await api.post('/zalo-accounts', {
        displayName: displayName || undefined,
        proxyUrl: proxyUrl?.trim() || undefined,
        phone: phone || undefined,
      });
      await fetchAccounts();
      return { ok: true, reused: !!data?.reused, account: data };
    } catch (err: any) {
      const code = err?.response?.data?.code || err?.response?.data?.error;
      const message = err?.response?.data?.message || 'Không tạo được nick.';
      console.error('Failed to add account:', code || err);
      return { ok: false, code, message };
    } finally {
      adding.value = false;
    }
  }

  async function updateProxy(accountId: string, proxyUrl: string | null) {
    try {
      await api.put(`/zalo-accounts/${accountId}/proxy`, { proxyUrl: proxyUrl?.trim() || null });
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Update proxy failed:', err);
      return false;
    }
  }

  async function loginAccount(accountId: string) {
    // FIX #B (2026-06-16): currentLoginAccountId là biến ĐƠN. Nếu đang chờ QR nick CŨ mà mở
    // login nick MỚI, phải UNSUBSCRIBE room nick cũ TRƯỚC khi đổi — nếu không room cũ rò
    // (socket vẫn nhận event nick cũ) + sau này cancelQR sẽ unsubscribe nhầm nick mới.
    const prevId = currentLoginAccountId.value;
    if (prevId && prevId !== accountId) {
      socket?.emit('zalo:unsubscribe', { accountId: prevId });
    }
    currentLoginAccountId.value = accountId;
    qrImage.value = '';
    qrScanned.value = false;
    scannedName.value = '';
    qrError.value = '';
    qrSessionDead.value = false; // FIX #2: reset cờ phiên-chết mỗi lần login fresh
    showQRDialog.value = true;
    socket?.emit('zalo:subscribe', { accountId });
    try {
      await api.post(`/zalo-accounts/${accountId}/login`, {});
    } catch (err: any) {
      qrError.value = err.response?.data?.error || 'Không thể bắt đầu đăng nhập';
    }
  }

  async function reconnectAccount(accountId: string): Promise<{ success: boolean; message: string; needsQR?: boolean }> {
    try {
      await api.post(`/zalo-accounts/${accountId}/reconnect`, {});
      await fetchAccounts();
      return { success: true, message: 'Đang kết nối lại nick…' };
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Kết nối lại thất bại';
      // 2026-06-20: BE trả 409 needs_qr cho nick NGẮT THỦ CÔNG (phiên cũ đã đóng → reconnect ngầm
      // vô nghĩa). FE phải rơi sang quét QR mới trên chính record cũ. message ưu tiên dạng "người đọc".
      if (err.response?.status === 409 && err.response?.data?.needsQR) {
        return { success: false, message: err.response.data.message || msg, needsQR: true };
      }
      // Nick chưa có phiên lưu (chưa từng login qua QR) → cần quét QR thay vì reconnect ngầm.
      if (err.response?.status === 400 && /no saved session/i.test(msg)) {
        return { success: false, message: msg, needsQR: true };
      }
      console.error('Reconnect failed:', err);
      return { success: false, message: msg };
    }
  }

  // 2026-06-20: BE BỎ tham số purge — xoá nick LUÔN là ẩn-mềm (giữ uid + tin nhắn). Kết nối lại
  // đúng nick này sẽ tự khôi phục. Không còn "Xoá khỏi CRM" wipe phiên.
  async function deleteAccount(account: ZaloAccount) {
    deleting.value = true;
    try {
      await api.delete(`/zalo-accounts/${account.id}`);
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Delete failed:', err);
      return false;
    } finally {
      deleting.value = false;
    }
  }

  function cancelQR() {
    showQRDialog.value = false;
    if (currentLoginAccountId.value) {
      socket?.emit('zalo:unsubscribe', { accountId: currentLoginAccountId.value });
      // code-review #3 (P3): clear để onReconnect KHÔNG re-subscribe room nick đã đóng (rò room
      // mỗi lần refresh token). Phiên login kết thúc → không còn nick nào "đang chờ QR".
      currentLoginAccountId.value = '';
    }
  }

  function setupSocket() {
    // FIX #4 (2026-06-16): socket reconnect (transport drop / token 15' refresh) đổi socket.id
    // → MẤT room account: đã join → mọi event zalo:qr/scanned/qr-expired (emit .to(account:))
    // bị rớt → QR "đứng hình", sale quét không lên. onReconnect: re-emit zalo:subscribe cho nick
    // đang login để join lại room. (use-chat đã dùng onReconnect bù tin; account-login trước bỏ sót.)
    socket = createAppSocket({
      onReconnect: () => {
        if (currentLoginAccountId.value) {
          socket?.emit('zalo:subscribe', { accountId: currentLoginAccountId.value });
        }
      },
    });

    socket.on('zalo:qr', (data: { accountId: string; qrImage: string }) => {
      if (data.accountId === currentLoginAccountId.value) qrImage.value = data.qrImage;
    });

    socket.on('zalo:scanned', (data: { accountId: string; displayName: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrScanned.value = true;
        scannedName.value = data.displayName;
      }
    });

    // FIX #1 (2026-06-16): CHỈ đóng QR dialog khi ĐÚNG nick đang login connected. Trước đây
    // không lọc accountId → bất kỳ nick nào (kể cả nick org khác do io.emit bare cũ) connect
    // → đóng dialog → wizard báo "thành công" giả cho nick CHƯA quét. fetchAccounts/onStatusChange
    // vẫn chạy cho MỌI nick (để danh sách cập nhật), nhưng showQRDialog chỉ đóng cho nick mình.
    socket.on('zalo:connected', (data: { accountId: string }) => {
      if (data.accountId === currentLoginAccountId.value) showQRDialog.value = false;
      fetchAccounts();
      opts?.onStatusChange?.(); // refresh grid enriched → card tự đổi sang "đang kết nối"
    });

    socket.on('zalo:disconnected', (_data: { accountId: string }) => { fetchAccounts(); opts?.onStatusChange?.(); });

    socket.on('zalo:error', (data: { accountId: string; error: string }) => {
      if (data.accountId === currentLoginAccountId.value) qrError.value = data.error;
      fetchAccounts();
      opts?.onStatusChange?.();
    });

    socket.on('zalo:qr-expired', (data: { accountId: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrError.value = 'QR đã hết hạn, đang tạo lại...';
      }
    });

    // FIX #2 (2026-06-16): BE đã DỪNG tự sinh QR sau N lần hết hạn (phiên SDK treo, quét không
    // ăn). FE hiện thông báo + nút "Quét lại" → onWizardRetryQr/loginAccount tạo phiên FRESH.
    socket.on('zalo:qr-session-dead', (data: { accountId: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrScanned.value = false;
        qrSessionDead.value = true;
        qrError.value = 'Mã QR đã hết hiệu lực. Bấm "Tạo QR mới" để quét lại.';
      }
    });

    socket.on('zalo:reconnect-failed', (_data: { accountId: string }) => { fetchAccounts(); opts?.onStatusChange?.(); });

    // fix ②: nick quét trúng zaloUid đã tồn tại (record rác đã bị BE xoá) → báo tử tế,
    // đóng QR. Khác zalo:error ở chỗ đây là tình huống nghiệp vụ (nick trùng), không phải lỗi kỹ thuật.
    socket.on('zalo:duplicate', (data: { accountId: string; owner: string | null; message: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrScanned.value = false;
        duplicateInfo.value = { owner: data.owner ?? null, message: data.message };
        showQRDialog.value = false;
      }
      fetchAccounts();
    });
  }

  // Quyền truy cập nick đổi (BE bắn qua socket use-chat → window event) → refetch nick list
  // để nick bị gỡ rớt khỏi cột 1 NGAY. Decoupled qua window để không phụ thuộc socket nào mount.
  function onAccessChanged() { fetchAccounts(); }
  onMounted(() => window.addEventListener('zalo-access-changed', onAccessChanged));

  onUnmounted(() => {
    socket?.disconnect();
    window.removeEventListener('zalo-access-changed', onAccessChanged);
  });

  return {
    accounts, loading, adding, deleting,
    showQRDialog, qrImage, qrScanned, scannedName, qrError, qrSessionDead, duplicateInfo,
    currentLoginAccountId,
    statusColor, statusText,
    fetchAccounts, addAccount, loginAccount, reconnectAccount, deleteAccount,
    updateProxy, cancelQR, setupSocket,
  };
}
