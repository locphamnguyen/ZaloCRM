/**
 * custom-attrs-api.ts — Typed API wrappers for Custom Attribute endpoints.
 * Routes use /api/v1 prefix → use the standard `api` instance.
 */
import { api } from '@/api/index';

// ─── Types ────────────────────────────────────────────────────────────────

export type AttrDataType = 'string' | 'number' | 'date' | 'boolean' | 'enum';

export interface AttrDef {
  id: string;
  key: string;
  label: string;
  dataType: AttrDataType;
  enumValues: string[] | null;
  required: boolean;
  createdAt: string;
}

export interface CreateAttrDefPayload {
  key: string;
  label: string;
  dataType: AttrDataType;
  enumValues?: string[] | null;
  required?: boolean;
}

export interface UpdateAttrDefPayload {
  label?: string;
  enumValues?: string[] | null;
  required?: boolean;
}

// ─── API functions ────────────────────────────────────────────────────────

export async function listAttrDefs(): Promise<AttrDef[]> {
  const res = await api.get<{ defs: AttrDef[] }>('/custom-attrs');
  return res.data.defs;
}

export async function createAttrDef(payload: CreateAttrDefPayload): Promise<AttrDef> {
  const res = await api.post<AttrDef>('/custom-attrs', payload);
  return res.data;
}

export async function updateAttrDef(id: string, payload: UpdateAttrDefPayload): Promise<AttrDef> {
  const res = await api.patch<AttrDef>(`/custom-attrs/${id}`, payload);
  return res.data;
}

export async function deleteAttrDef(id: string): Promise<void> {
  await api.delete(`/custom-attrs/${id}`);
}

export async function patchContactCustomAttrs(
  contactId: string,
  attrs: Record<string, unknown>,
): Promise<{ id: string; customAttrs: Record<string, unknown> }> {
  const res = await api.patch(`/contacts/${contactId}/custom-attrs`, attrs);
  return res.data;
}
