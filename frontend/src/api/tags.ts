import { api } from '@/api/index';

// ─── Types ────────────────────────────────────────────────────────────────

export type TagSource = 'crm' | 'zalo';

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  source: TagSource;
  orgId: string;
  createdAt: string;
  _count?: { contactTags: number };
}

export interface ContactTag {
  tagId: string;
  tag: Tag;
  assignedAt: string;
}

export interface AutoTagRule {
  id: string;
  name: string;
  event: 'message_received' | 'message_sent' | 'status_changed';
  conditions: RuleCondition[];
  tagId: string;
  tag?: Tag;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuleCondition {
  field: string;
  operator: 'contains' | 'in' | 'gte' | 'lte' | 'eq';
  value: string | string[] | number;
}

export interface CreateTagPayload {
  name: string;
  color?: string | null;
  source?: TagSource;
}

export interface UpdateTagPayload {
  name?: string;
  color?: string | null;
}

export interface CreateRulePayload {
  name: string;
  event: AutoTagRule['event'];
  conditions: RuleCondition[];
  tagId: string;
  enabled?: boolean;
}

export interface UpdateRulePayload {
  name?: string;
  event?: AutoTagRule['event'];
  conditions?: RuleCondition[];
  tagId?: string;
  enabled?: boolean;
}

export interface TestRuleResult {
  matched: boolean;
  reason?: string;
}

// ─── Tag CRUD ─────────────────────────────────────────────────────────────

export async function listTags(source?: TagSource): Promise<Tag[]> {
  const params = source ? { source } : undefined;
  const res = await api.get('/tags', { params });
  return res.data.tags ?? [];
}

export async function createTag(payload: CreateTagPayload): Promise<Tag> {
  const res = await api.post('/tags', payload);
  return res.data.tag;
}

export async function updateTag(id: string, payload: UpdateTagPayload): Promise<Tag> {
  const res = await api.patch(`/tags/${id}`, payload);
  return res.data.tag;
}

export async function deleteTag(id: string): Promise<void> {
  await api.delete(`/tags/${id}`);
}

// ─── Contact Tags ─────────────────────────────────────────────────────────

export async function listContactTags(contactId: string): Promise<ContactTag[]> {
  const res = await api.get(`/contacts/${contactId}/tags`);
  return res.data.tags ?? [];
}

export async function addContactTag(contactId: string, tagId: string): Promise<void> {
  await api.post(`/contacts/${contactId}/tags`, { tagId });
}

export async function removeContactTag(contactId: string, tagId: string): Promise<void> {
  await api.delete(`/contacts/${contactId}/tags/${tagId}`);
}

// ─── Auto-tag Rules ───────────────────────────────────────────────────────

export async function listAutoTagRules(): Promise<AutoTagRule[]> {
  const res = await api.get('/auto-tag-rules');
  return res.data.rules ?? [];
}

export async function createAutoTagRule(payload: CreateRulePayload): Promise<AutoTagRule> {
  const res = await api.post('/auto-tag-rules', payload);
  return res.data.rule;
}

export async function updateAutoTagRule(id: string, payload: UpdateRulePayload): Promise<AutoTagRule> {
  const res = await api.patch(`/auto-tag-rules/${id}`, payload);
  return res.data.rule;
}

export async function deleteAutoTagRule(id: string): Promise<void> {
  await api.delete(`/auto-tag-rules/${id}`);
}

export async function testAutoTagRule(id: string, samplePayload: unknown): Promise<TestRuleResult> {
  const res = await api.post(`/auto-tag-rules/${id}/test`, { payload: samplePayload });
  return res.data;
}
