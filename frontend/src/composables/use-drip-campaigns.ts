import { ref } from 'vue';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  type DripCampaign,
  type CreateCampaignPayload,
} from '@/api/drip-api';

export type { DripCampaign, CreateCampaignPayload };

export function useDripCampaigns() {
  const campaigns = ref<DripCampaign[]>([]);
  const loading = ref(false);
  const saving = ref(false);

  async function fetchCampaigns() {
    loading.value = true;
    try {
      campaigns.value = await listCampaigns();
    } catch (err) {
      console.error('fetchCampaigns error:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchCampaign(id: string): Promise<DripCampaign | null> {
    try {
      return await getCampaign(id);
    } catch (err) {
      console.error('fetchCampaign error:', err);
      return null;
    }
  }

  async function createNewCampaign(payload: CreateCampaignPayload): Promise<DripCampaign | null> {
    saving.value = true;
    try {
      const campaign = await createCampaign(payload);
      await fetchCampaigns();
      return campaign;
    } catch (err) {
      console.error('createCampaign error:', err);
      return null;
    } finally {
      saving.value = false;
    }
  }

  async function updateExistingCampaign(id: string, payload: Partial<CreateCampaignPayload>): Promise<DripCampaign | null> {
    saving.value = true;
    try {
      const campaign = await updateCampaign(id, payload);
      await fetchCampaigns();
      return campaign;
    } catch (err) {
      console.error('updateCampaign error:', err);
      return null;
    } finally {
      saving.value = false;
    }
  }

  async function removeCampaign(id: string): Promise<boolean> {
    saving.value = true;
    try {
      await deleteCampaign(id);
      await fetchCampaigns();
      return true;
    } catch (err) {
      console.error('deleteCampaign error:', err);
      return false;
    } finally {
      saving.value = false;
    }
  }

  return {
    campaigns,
    loading,
    saving,
    fetchCampaigns,
    fetchCampaign,
    createNewCampaign,
    updateExistingCampaign,
    removeCampaign,
  };
}
