-- ============================================================================
-- tenant-rls.sql — Phase 1a Postgres Row-Level Security (Bảo mật xác thực)
-- Sinh từ DB thật (information_schema): 62 bảng có cột org_id.
-- ============================================================================
-- BIÊN GIỚI CHÍNH cô lập tenant (T1-A). Bắt MỌI query shape kể cả raw SQL,
-- updateMany, nested write — thứ Prisma extension dễ sót.
--
-- ⚠️ CHƯA APPLY tự động. Rollout an toàn:
--   1. App set per-connection (Giai đoạn 0 — ĐÃ CODE): set RLS_SET_CONFIG=true →
--      Prisma extension + tenantTransaction() tự chạy set_config('app.current_org', $orgId, true)
--      (SET LOCAL trong transaction).
--   2. TENANT_GUARD_MODE=warn trên staging tới khi 0 cảnh báo (worker đã withTenant).
--   3. Apply file này trên staging, test IDOR HTTP 6 path CRITICAL.
--   4. Apply production + TENANT_GUARD_MODE=enforce.
--
-- ĐƯỜNG BYPASS (cross-org hợp lệ): policy cho qua khi
--   current_setting('app.bypass_rls', true) = 'on'. App set GUC này (LOCAL) cho
--   runSystemQuery() — auth lookup tìm user theo email/id KHI CHƯA biết org, healthcheck
--   cross-org... KHÔNG có bypass thì các query này trả 0 dòng (app.current_org rỗng).
--   Chỉ app set được trong transaction → không nới lỏng biên giới thực sự.
--
-- LƯU Ý ROLE: role app KHÔNG được superuser/owner (BYPASSRLS). Dùng FORCE +
-- role thường. Migration/seed chạy role owner (bypass) là chủ ý.
-- ============================================================================

-- account_folders
ALTER TABLE "account_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_folders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "account_folders";
CREATE POLICY tenant_isolation ON "account_folders"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- activity_logs
ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "activity_logs";
CREATE POLICY tenant_isolation ON "activity_logs"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- ai_configs
ALTER TABLE "ai_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_configs";
CREATE POLICY tenant_isolation ON "ai_configs"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- ai_agent_configs
ALTER TABLE "ai_agent_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_agent_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_agent_configs";
CREATE POLICY tenant_isolation ON "ai_agent_configs"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- ai_suggestions
ALTER TABLE "ai_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_suggestions";
CREATE POLICY tenant_isolation ON "ai_suggestions"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- ai_suggestions_applied
ALTER TABLE "ai_suggestions_applied" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions_applied" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_suggestions_applied";
CREATE POLICY tenant_isolation ON "ai_suggestions_applied"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- app_settings
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "app_settings";
CREATE POLICY tenant_isolation ON "app_settings"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- appointments
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "appointments";
CREATE POLICY tenant_isolation ON "appointments"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- automation_broadcasts
ALTER TABLE "automation_broadcasts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_broadcasts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "automation_broadcasts";
CREATE POLICY tenant_isolation ON "automation_broadcasts"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- automation_campaigns
ALTER TABLE "automation_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_campaigns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "automation_campaigns";
CREATE POLICY tenant_isolation ON "automation_campaigns"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- automation_event_log
ALTER TABLE "automation_event_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_event_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "automation_event_log";
CREATE POLICY tenant_isolation ON "automation_event_log"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- automation_rules
ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "automation_rules";
CREATE POLICY tenant_isolation ON "automation_rules"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- automation_sequences
ALTER TABLE "automation_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_sequences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "automation_sequences";
CREATE POLICY tenant_isolation ON "automation_sequences"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- automation_triggers
ALTER TABLE "automation_triggers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_triggers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "automation_triggers";
CREATE POLICY tenant_isolation ON "automation_triggers"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- block_folders
ALTER TABLE "block_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "block_folders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "block_folders";
CREATE POLICY tenant_isolation ON "block_folders"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- blocks
ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blocks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "blocks";
CREATE POLICY tenant_isolation ON "blocks"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- contact_access
ALTER TABLE "contact_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_access" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contact_access";
CREATE POLICY tenant_isolation ON "contact_access"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- contact_engagement_daily
ALTER TABLE "contact_engagement_daily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_engagement_daily" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contact_engagement_daily";
CREATE POLICY tenant_isolation ON "contact_engagement_daily"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- contacts
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contacts";
CREATE POLICY tenant_isolation ON "contacts"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- conversations
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "conversations";
CREATE POLICY tenant_isolation ON "conversations"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- crm_tag_groups
ALTER TABLE "crm_tag_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_tag_groups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_tag_groups";
CREATE POLICY tenant_isolation ON "crm_tag_groups"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- crm_tags
ALTER TABLE "crm_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_tags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_tags";
CREATE POLICY tenant_isolation ON "crm_tags"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- customer_lists
ALTER TABLE "customer_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_lists" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "customer_lists";
CREATE POLICY tenant_isolation ON "customer_lists"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- daily_message_stats
ALTER TABLE "daily_message_stats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_message_stats" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "daily_message_stats";
CREATE POLICY tenant_isolation ON "daily_message_stats"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- departments
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "departments";
CREATE POLICY tenant_isolation ON "departments"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- duplicate_groups
ALTER TABLE "duplicate_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "duplicate_groups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "duplicate_groups";
CREATE POLICY tenant_isolation ON "duplicate_groups"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- facebook_leadgen_forms
ALTER TABLE "facebook_leadgen_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "facebook_leadgen_forms" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "facebook_leadgen_forms";
CREATE POLICY tenant_isolation ON "facebook_leadgen_forms"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- facebook_page_accounts
ALTER TABLE "facebook_page_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "facebook_page_accounts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "facebook_page_accounts";
CREATE POLICY tenant_isolation ON "facebook_page_accounts"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- friends
ALTER TABLE "friends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "friends" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "friends";
CREATE POLICY tenant_isolation ON "friends"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- friendship_attempts
ALTER TABLE "friendship_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "friendship_attempts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "friendship_attempts";
CREATE POLICY tenant_isolation ON "friendship_attempts"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- group_polls
ALTER TABLE "group_polls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group_polls" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "group_polls";
CREATE POLICY tenant_isolation ON "group_polls"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- integrations
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "integrations";
CREATE POLICY tenant_isolation ON "integrations"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- lead_pool_bonus_quotas
ALTER TABLE "lead_pool_bonus_quotas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_pool_bonus_quotas" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lead_pool_bonus_quotas";
CREATE POLICY tenant_isolation ON "lead_pool_bonus_quotas"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- lead_pool_configs
ALTER TABLE "lead_pool_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_pool_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lead_pool_configs";
CREATE POLICY tenant_isolation ON "lead_pool_configs"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- lead_requests
ALTER TABLE "lead_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lead_requests";
CREATE POLICY tenant_isolation ON "lead_requests"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- message_templates
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "message_templates";
CREATE POLICY tenant_isolation ON "message_templates"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- meta_campaign_cache
ALTER TABLE "meta_campaign_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meta_campaign_cache" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "meta_campaign_cache";
CREATE POLICY tenant_isolation ON "meta_campaign_cache"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- nba_templates
ALTER TABLE "nba_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nba_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "nba_templates";
CREATE POLICY tenant_isolation ON "nba_templates"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- notes
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notes";
CREATE POLICY tenant_isolation ON "notes"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- notify_dedup_state
ALTER TABLE "notify_dedup_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notify_dedup_state" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notify_dedup_state";
CREATE POLICY tenant_isolation ON "notify_dedup_state"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- parent_candidates
ALTER TABLE "parent_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parent_candidates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "parent_candidates";
CREATE POLICY tenant_isolation ON "parent_candidates"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- permission_groups
ALTER TABLE "permission_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permission_groups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "permission_groups";
CREATE POLICY tenant_isolation ON "permission_groups"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- phone_search_events
ALTER TABLE "phone_search_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phone_search_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "phone_search_events";
CREATE POLICY tenant_isolation ON "phone_search_events"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- pinned_conversations
ALTER TABLE "pinned_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pinned_conversations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "pinned_conversations";
CREATE POLICY tenant_isolation ON "pinned_conversations"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- saved_filter_presets
ALTER TABLE "saved_filter_presets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_filter_presets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "saved_filter_presets";
CREATE POLICY tenant_isolation ON "saved_filter_presets"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- saved_reports
ALTER TABLE "saved_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_reports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "saved_reports";
CREATE POLICY tenant_isolation ON "saved_reports"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- score_signal_rules
ALTER TABLE "score_signal_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "score_signal_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "score_signal_rules";
CREATE POLICY tenant_isolation ON "score_signal_rules"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- scoring_configs
ALTER TABLE "scoring_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scoring_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "scoring_configs";
CREATE POLICY tenant_isolation ON "scoring_configs"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- sdk_limits
ALTER TABLE "sdk_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sdk_limits" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sdk_limits";
CREATE POLICY tenant_isolation ON "sdk_limits"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- stage_transition_rules
ALTER TABLE "stage_transition_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stage_transition_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "stage_transition_rules";
CREATE POLICY tenant_isolation ON "stage_transition_rules"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- statuses
ALTER TABLE "statuses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "statuses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "statuses";
CREATE POLICY tenant_isolation ON "statuses"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- stuck_thresholds
ALTER TABLE "stuck_thresholds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stuck_thresholds" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "stuck_thresholds";
CREATE POLICY tenant_isolation ON "stuck_thresholds"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- system_notifications
ALTER TABLE "system_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "system_notifications";
CREATE POLICY tenant_isolation ON "system_notifications"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- system_notify_recipients
ALTER TABLE "system_notify_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_notify_recipients" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "system_notify_recipients";
CREATE POLICY tenant_isolation ON "system_notify_recipients"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- tag_groups
ALTER TABLE "tag_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tag_groups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tag_groups";
CREATE POLICY tenant_isolation ON "tag_groups"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- tags
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tags";
CREATE POLICY tenant_isolation ON "tags"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- teams
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "teams";
CREATE POLICY tenant_isolation ON "teams"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- trigger_queue_entries
ALTER TABLE "trigger_queue_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trigger_queue_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trigger_queue_entries";
CREATE POLICY tenant_isolation ON "trigger_queue_entries"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- users
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "users";
CREATE POLICY tenant_isolation ON "users"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- webhook_logs
ALTER TABLE "webhook_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "webhook_logs";
CREATE POLICY tenant_isolation ON "webhook_logs"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- zalo_account_status_log
ALTER TABLE "zalo_account_status_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zalo_account_status_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "zalo_account_status_log";
CREATE POLICY tenant_isolation ON "zalo_account_status_log"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- zalo_accounts
ALTER TABLE "zalo_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zalo_accounts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "zalo_accounts";
CREATE POLICY tenant_isolation ON "zalo_accounts"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- zalo_labels
ALTER TABLE "zalo_labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zalo_labels" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "zalo_labels";
CREATE POLICY tenant_isolation ON "zalo_labels"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- ── Phase Media Library 2026-06-11 — 3 bảng media có org_id ────────────────
-- media_album_items + media_upload_refs KHÔNG có org_id → bảo vệ gián tiếp qua
-- FK cascade (album→org, blob→org). Chỉ cần policy cho 3 bảng có org_id.

-- media_blobs
ALTER TABLE "media_blobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_blobs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "media_blobs";
CREATE POLICY tenant_isolation ON "media_blobs"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- media_assets
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_assets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "media_assets";
CREATE POLICY tenant_isolation ON "media_assets"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- media_albums
ALTER TABLE "media_albums" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_albums" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "media_albums";
CREATE POLICY tenant_isolation ON "media_albums"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');


-- ── Zalo Ads Lead Form (Extension, thêm 2026-06-20) ────────────────────────
-- zalo_oa_app_configs
ALTER TABLE "zalo_oa_app_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zalo_oa_app_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "zalo_oa_app_configs";
CREATE POLICY tenant_isolation ON "zalo_oa_app_configs"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- zalo_oa_connections
ALTER TABLE "zalo_oa_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zalo_oa_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "zalo_oa_connections";
CREATE POLICY tenant_isolation ON "zalo_oa_connections"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- zalo_form_mappings
ALTER TABLE "zalo_form_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zalo_form_mappings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "zalo_form_mappings";
CREATE POLICY tenant_isolation ON "zalo_form_mappings"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');

-- zalo_lead_events
ALTER TABLE "zalo_lead_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zalo_lead_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "zalo_lead_events";
CREATE POLICY tenant_isolation ON "zalo_lead_events"
  USING ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("org_id" = current_setting('app.current_org', true) OR current_setting('app.bypass_rls', true) = 'on');
