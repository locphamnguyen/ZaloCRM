import { api } from '@/api/index';

// ─── Types ────────────────────────────────────────────────────────────────

export interface DripStep {
  id?: string;
  stepIndex?: number;
  templateId?: string | null;
  content?: string | null;
  dayOffset?: number;
}

export interface DripCampaign {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  windowStart: number;
  windowEnd: number;
  timezone: string;
  startTrigger: string;
  startTag?: string | null;
  stopOnReply: boolean;
  stopOnTag?: string | null;
  stopOnInactiveDays?: number | null;
  createdAt: string;
  steps?: DripStep[];
  _count?: { enrollments: number; steps: number };
}

export interface DripEnrollment {
  id: string;
  campaignId: string;
  contactId: string;
  currentStep: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  scheduledAt?: string | null;
  lastSentAt?: string | null;
  startedAt: string;
  completedAt?: string | null;
  contact?: { id: string; fullName: string | null; crmName: string | null; phone: string | null };
  campaign?: { id: string; name: string };
}

export interface DripLog {
  id: string;
  enrollmentId: string;
  stepIndex: number;
  sentAt: string;
  status: string;
  error?: string | null;
}

export interface CreateCampaignPayload {
  name: string;
  description?: string | null;
  enabled?: boolean;
  windowStart?: number;
  windowEnd?: number;
  timezone?: string;
  startTrigger?: string;
  startTag?: string | null;
  stopOnReply?: boolean;
  stopOnTag?: string | null;
  stopOnInactiveDays?: number | null;
  steps: DripStep[];
}

export interface EnrollmentFilters {
  page?: number;
  limit?: number;
  campaignId?: string;
  status?: string;
  contactId?: string;
}

export interface DripHistoryItem {
  id: string;
  campaignId: string;
  campaignName: string;
  currentStep: number;
  totalSteps: number;
  status: string;
  nextSendAt: string | null;
  lastSentAt: string | null;
  startedAt: string;
  logs?: DripLog[];
}

// ─── Campaign API ─────────────────────────────────────────────────────────

export async function listCampaigns(): Promise<DripCampaign[]> {
  const res = await api.get('/drip/campaigns');
  return res.data.campaigns ?? [];
}

export async function getCampaign(id: string): Promise<DripCampaign> {
  const res = await api.get(`/drip/campaigns/${id}`);
  return res.data.campaign;
}

export async function createCampaign(payload: CreateCampaignPayload): Promise<DripCampaign> {
  const res = await api.post('/drip/campaigns', payload);
  return res.data.campaign;
}

export async function updateCampaign(id: string, payload: Partial<CreateCampaignPayload>): Promise<DripCampaign> {
  const res = await api.put(`/drip/campaigns/${id}`, payload);
  return res.data.campaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  await api.delete(`/drip/campaigns/${id}`);
}

// ─── Enrollment API ───────────────────────────────────────────────────────

export async function listEnrollments(filters: EnrollmentFilters = {}): Promise<{ items: DripEnrollment[]; total: number; page: number; limit: number }> {
  const res = await api.get('/drip/enrollments', { params: filters });
  return res.data;
}

export async function enroll(campaignId: string, payload: { contactIds: string[] }): Promise<unknown> {
  const res = await api.post(`/drip/campaigns/${campaignId}/enroll`, payload);
  return res.data;
}

export async function pauseEnrollment(id: string): Promise<DripEnrollment> {
  const res = await api.post(`/drip/enrollments/${id}/pause`);
  return res.data.enrollment;
}

export async function resumeEnrollment(id: string): Promise<DripEnrollment> {
  const res = await api.post(`/drip/enrollments/${id}/resume`);
  return res.data.enrollment;
}

export async function cancelEnrollment(id: string): Promise<DripEnrollment> {
  const res = await api.post(`/drip/enrollments/${id}/cancel`);
  return res.data.enrollment;
}

export async function getEnrollmentLogs(id: string): Promise<DripLog[]> {
  const res = await api.get(`/drip/enrollments/${id}/logs`);
  return res.data.logs ?? [];
}

export async function bulkEnrollmentAction(campaignId: string, payload: { action: 'pause' | 'resume' | 'cancel'; filter: { status: string } }): Promise<{ affected: number }> {
  const res = await api.post(`/drip/campaigns/${campaignId}/bulk`, payload);
  return res.data;
}

export async function getContactDripHistory(contactId: string): Promise<DripHistoryItem[]> {
  const res = await api.get(`/contacts/${contactId}/drip-history`);
  return res.data.enrollments ?? [];
}
