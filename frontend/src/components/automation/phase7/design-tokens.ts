// Phase 7 Marketing — Airtable-design-analysis tokens (v=alpha).
//
// Source: DESIGN.md `Airtable-design-analysis` anh đính kèm 2026-05-20.
// Memory: reference_design_airtable_inspiration.md.
//
// Rules from spec:
//   - Primary CTA is near-black (#181d26), NOT link blue (#1b61c9).
//   - White canvas hero — no gradient/mesh/aurora.
//   - Brand voltage via full-bleed signature cards (coral/forest/dark/cream).
//   - Typography: weight 400 for display, 500 for buttons/sub-titles. Never 700.
//   - Section vertical rhythm: 96px.
//   - No hover state — only Default + Active/Pressed.
//
// Re-exports: action-type + trigger-category palettes use the Airtable
// signature card colors so chips and accent bars feel native to the brand.

import type { BlockActionType, TriggerCategory } from '@/api/automation/types';

// ── Core color tokens (verbatim from Airtable-design-analysis) ─────────────
export const AT = {
  // Brand
  primary:         '#181d26',
  primaryActive:   '#0d1218',
  ink:             '#181d26',
  body:            '#333840',
  muted:           '#41454d',
  hairline:        '#dddddd',
  borderStrong:    '#9297a0',

  // Surfaces
  canvas:          '#ffffff',
  surfaceSoft:     '#f8fafc',
  surfaceStrong:   '#e0e2e6',
  surfaceDark:     '#181d26',

  // Signature card surfaces (brand voltage)
  signatureCoral:  '#aa2d00',
  signatureForest: '#0a2e0e',
  signatureCream:  '#f5e9d4',
  signaturePeach:  '#fcab79',
  signatureMint:   '#a8d8c4',
  signatureYellow: '#f4d35e',
  signatureMustard:'#d9a441',

  // Semantic
  link:            '#1b61c9',
  linkActive:      '#1a3866',
  info:            '#254fad',
  infoBorder:      '#458fff',
  success:         '#006400',
  successBorder:   '#39bf45',

  // Text on dark surfaces
  onPrimary:       '#ffffff',
  onDark:          '#ffffff',
} as const;

// ── Radius scale ───────────────────────────────────────────────────────────
export const RADIUS = {
  xs:   '2px',
  sm:   '6px',   // text inputs
  md:   '10px',  // content cards, article cards, cream callouts
  lg:   '12px',  // primary CTAs, signature surface cards
  pill: '9999px',
  full: '9999px',
} as const;

// ── Spacing (4-multiples) ──────────────────────────────────────────────────
export const SPACE = {
  xxs:     '4px',
  xs:      '8px',
  sm:      '12px',
  md:      '16px',
  lg:      '24px',
  xl:      '32px',
  xxl:     '48px',
  section: '96px',
} as const;

// ── Typography scale ───────────────────────────────────────────────────────
// Haas falls back to Inter Display / system. We keep the Vuetify-loaded font
// and only enforce the size/weight/line-height/letter-spacing per role.
export const TYPE = {
  displayLg: { fontSize: '40px',   fontWeight: 400, lineHeight: 1.2,  letterSpacing: '0' },
  displayMd: { fontSize: '32px',   fontWeight: 400, lineHeight: 1.2,  letterSpacing: '0' },
  titleLg:   { fontSize: '24px',   fontWeight: 400, lineHeight: 1.35, letterSpacing: '0.12px' },
  titleMd:   { fontSize: '20px',   fontWeight: 400, lineHeight: 1.5,  letterSpacing: '0' },
  titleSm:   { fontSize: '18px',   fontWeight: 500, lineHeight: 1.4,  letterSpacing: '0' },
  labelMd:   { fontSize: '16px',   fontWeight: 500, lineHeight: 1.4,  letterSpacing: '0' },
  button:    { fontSize: '16px',   fontWeight: 500, lineHeight: 1.4,  letterSpacing: '0' },
  bodyMd:    { fontSize: '14px',   fontWeight: 400, lineHeight: 1.25, letterSpacing: '0' },
  caption:   { fontSize: '14px',   fontWeight: 500, lineHeight: 1.35, letterSpacing: '0.16px' },
  legal:     { fontSize: '13.12px',fontWeight: 600, lineHeight: 1.2,  letterSpacing: '0' },
} as const;

// ── Action-type accent (uses signature colors, not arbitrary indigo/emerald) ─
// Maps Block.actionType → { bg, tint, text } trio for chip/icon styling.
// Bg = bold surface for solid icon avatars; tint = soft band for left accent + light fills;
// text = readable foreground on the tint.
export const ACTION_TYPE_COLOR: Record<BlockActionType, { bg: string; tint: string; text: string }> = {
  // Phase G ship-first actions get the strongest brand colors
  request_friend:    { bg: AT.signatureCoral,   tint: '#fbe6dc', text: '#7a2000' },
  send_message:      { bg: AT.signatureForest,  tint: '#e3ede4', text: '#0a2e0e' },
  update_status:     { bg: AT.signatureMustard, tint: '#fdf3df', text: '#7a5818' },
  // Reserved (Phase H+) — use softer signature surfaces
  send_image:        { bg: AT.signaturePeach,   tint: '#fdf0e3', text: '#7a4115' },
  send_file:         { bg: AT.muted,            tint: '#f0f1f3', text: AT.body },
  send_template:     { bg: AT.signatureMint,    tint: '#e8f4ee', text: '#1f4d39' },
  add_tag:           { bg: AT.signatureYellow,  tint: '#fdf8e0', text: '#6b5615' },
  remove_tag:        { bg: AT.borderStrong,     tint: '#f0f1f3', text: AT.muted },
  assign_user:       { bg: AT.link,             tint: '#dfeafc', text: AT.linkActive },
  update_lead_score: { bg: AT.signatureCoral,   tint: '#fbe6dc', text: '#7a2000' },
};

// ── Trigger category accent (5 categories from Airtable signature palette) ──
export const CATEGORY_COLOR: Record<TriggerCategory, { bg: string; tint: string; text: string; label: string }> = {
  general:  { bg: AT.primary,          tint: '#eaecef', text: AT.ink,           label: 'Chung' },
  keyword:  { bg: AT.signatureForest,  tint: '#e3ede4', text: '#0a2e0e',         label: 'Từ khoá' },
  bot_api:  { bg: AT.link,             tint: '#dfeafc', text: AT.linkActive,    label: 'Bot API' },
  livechat: { bg: AT.signatureMustard, tint: '#fdf3df', text: '#7a5818',         label: 'Live Chat' },
  genai:    { bg: AT.signatureCoral,   tint: '#fbe6dc', text: '#7a2000',         label: 'GenAI' },
};

// ── Event-type → icon glyph (mdi) ──────────────────────────────────────────
export const EVENT_ICON: Record<string, string> = {
  friendship_accepted:     'mdi-account-heart',
  friendship_received:     'mdi-account-question-outline',
  first_message_received:  'mdi-message-reply-text-outline',
  message_received:        'mdi-message-outline',
  keyword_match:           'mdi-text-search',
  contact_created:         'mdi-account-plus',
  contact_status_changed:  'mdi-tag-arrow-right',
  contact_imported:        'mdi-database-import',
  birthday:                'mdi-cake-variant',
  scheduled_cron:          'mdi-clock-time-eight-outline',
  time_elapsed:            'mdi-timer-sand',
  manual_run:              'mdi-gesture-tap-button',
  order_success:           'mdi-cart-check',
};

export function iconForEvent(eventType: string): string {
  return EVENT_ICON[eventType] ?? 'mdi-flash';
}
