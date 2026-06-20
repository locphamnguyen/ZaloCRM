// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Composable for ChatContactPanel state and actions:
 * - Form population from contact
 * - Save contact info
 * - Fetch appointments for contact
 */
import { ref, watch, reactive } from 'vue';
import { useContacts, type Contact } from '@/composables/use-contacts';
import { api } from '@/api/index';
import type { Appointment } from '@/components/chat/ChatAppointments.vue';

export function useChatContactPanel(
  getContactId: () => string | null,
  getContact: () => Contact | null,
  onSaved: () => void,
) {
  const { updateContact, fetchContact } = useContacts();

  const saving = ref(false);
  const saveSuccess = ref(false);
  const saveError = ref(false);
  const contactAppointments = ref<Appointment[]>([]);

  const form = reactive({
    fullName: '',
    crmName: '',
    phone: '',
    // SĐT phụ — list động nhãn tự nhập (Anh chốt 2026-06-06). [{label, phone}].
    // phone2/phone3 cũ được GỘP vào đây lúc populate để không mất số KH cũ.
    phonesExtra: [] as Array<{ label: string; phone: string }>,
    email: '',
    gender: null as string | null,
    birthDate: '',
    addressLine: '',
    occupation: '',
    source: null as string | null,
    status: null as string | null,
    nextAppointmentDate: '',
    firstContactDate: '',
    tags: [] as string[],
    notes: '',
  });

  function populateForm(c: Contact) {
    form.fullName = c.fullName ?? '';
    form.crmName = c.crmName ?? '';
    form.phone = c.phone ?? '';
    // Gộp phonesExtra (mới) + phone2/phone3 (cũ) → 1 list. Số cũ gắn nhãn mặc định
    // 'SĐT 2'/'SĐT 3' để sale thấy + đổi nhãn lại. Dedup theo số để không lặp khi
    // số cũ đã được migrate vào phonesExtra.
    {
      const extra: Array<{ label: string; phone: string }> = [];
      const seen = new Set<string>();
      const pushPhone = (phone: string | null | undefined, label: string) => {
        const p = (phone ?? '').trim();
        if (!p || seen.has(p)) return;
        seen.add(p);
        extra.push({ label, phone: p });
      };
      const raw = (c as { phonesExtra?: Array<{ label?: string; phone?: string }> }).phonesExtra;
      if (Array.isArray(raw)) {
        for (const e of raw) pushPhone(e?.phone, e?.label || '');
      }
      pushPhone(c.phone2, 'SĐT 2');
      pushPhone(c.phone3, 'SĐT 3');
      form.phonesExtra = extra;
    }
    form.email = c.email ?? '';
    form.gender = c.gender ?? null;
    form.birthDate = c.birthDate ? c.birthDate.slice(0, 10) : '';
    form.addressLine = c.addressLine ?? '';
    form.occupation = c.occupation ?? '';
    form.source = c.source ?? null;
    form.status = c.status ?? null;
    form.nextAppointmentDate = c.nextAppointment
      ? new Date(c.nextAppointment).toISOString().split('T')[0]
      : '';
    form.firstContactDate = c.firstContactDate
      ? new Date(c.firstContactDate).toISOString().split('T')[0]
      : '';
    form.tags = Array.isArray(c.tags) ? [...c.tags] : [];
    form.notes = c.notes ?? '';
  }

  async function fetchContactExtras(contactId: string) {
    try {
      const res = await api.get(`/contacts/${contactId}/appointments`);
      contactAppointments.value = res.data.appointments ?? [];
    } catch (err) {
      console.error('fetchContactExtras error:', err);
    }
  }

  async function reloadAppointments() {
    const id = getContactId();
    if (!id) return;
    try {
      const res = await api.get(`/contacts/${id}/appointments`);
      contactAppointments.value = res.data.appointments ?? [];
    } catch (err) {
      console.error('reloadAppointments error:', err);
    }
  }

  // Watch theo contact.id để repopulate form khi đổi sang KH khác.
  // KHÔNG re-populate khi cùng contact (giữ field user đang edit).
  watch(() => getContact()?.id, async () => {
    const c = getContact();
    if (!c) return;
    populateForm(c);          // populate nhanh từ payload conversation (tránh nháy trống)
    fetchContactExtras(c.id);
    // payload conversation (props.contact) CHỈ có field tối thiểu — THIẾU phonesExtra,
    // phone2/3, gender, birthDate. Fetch bản đầy đủ rồi re-populate để cột 4 hiện đủ
    // SĐT phụ + giới tính + ngày sinh (Anh báo trống 2026-06-06).
    const full = await fetchContact(c.id);
    if (full && full.id === getContact()?.id) populateForm(full);
  }, { immediate: true });

  // Sync narrow fields từ ngoài vào (cột 3 đổi status / tags → cột 4 update theo).
  // Chỉ sync status + tags vì đây là những field được mutate từ component khác.
  // Các field text (name, phone, ...) user edit trực tiếp ở cột 4 nên KHÔNG sync ngược.
  watch(() => getContact()?.status, (s) => {
    if (s !== undefined && s !== form.status) form.status = s;
  });
  watch(() => getContact()?.tags, (t) => {
    const arr = Array.isArray(t) ? [...t] : [];
    // Compare shallow — chỉ update nếu khác (tránh override khi user vừa edit)
    if (arr.length !== form.tags.length || arr.some((v, i) => v !== form.tags[i])) {
      form.tags = arr;
    }
  }, { deep: true });

  async function saveContact() {
    const contactId = getContactId();
    if (!contactId) return;
    saving.value = true;
    saveSuccess.value = false;
    saveError.value = false;

    const result = await updateContact(contactId, {
      fullName: form.fullName || null,
      crmName: form.crmName || null,
      phone: form.phone || null,
      // Lưu list động phonesExtra (lọc dòng rỗng). phone2/phone3 cũ đã gộp vào đây lúc
      // populate → set null để không nhân đôi số. Số cũ vẫn còn trong phonesExtra.
      phonesExtra: form.phonesExtra
        .map((p) => ({ label: (p.label || '').trim(), phone: (p.phone || '').trim() }))
        .filter((p) => p.phone),
      phone2: null,
      phone3: null,
      email: form.email || null,
      gender: form.gender || null,
      birthDate: form.birthDate
        ? new Date(form.birthDate + 'T00:00:00').toISOString()
        : null,
      addressLine: form.addressLine || null,
      occupation: form.occupation || null,
      source: form.source || null,
      status: form.status || null,
      nextAppointment: form.nextAppointmentDate
        ? new Date(form.nextAppointmentDate + 'T00:00:00').toISOString()
        : null,
      firstContactDate: form.firstContactDate
        ? new Date(form.firstContactDate + 'T00:00:00').toISOString()
        : null,
      tags: form.tags,
      notes: form.notes || null,
    });

    saving.value = false;
    if (result) {
      const fresh = await fetchContact(contactId);
      if (fresh) populateForm(fresh);
      saveSuccess.value = true;
      onSaved();
      setTimeout(() => { saveSuccess.value = false; }, 2500);
    } else {
      saveError.value = true;
    }
  }

  return {
    form,
    saving, saveSuccess, saveError,
    contactAppointments,
    saveContact, reloadAppointments,
  };
}
