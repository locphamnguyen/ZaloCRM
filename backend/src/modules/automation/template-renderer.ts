export interface AutomationTemplateContext {
  org?: { id: string; name: string | null } | null;
  contact?: {
    id: string;
    fullName: string | null;
    crmName?: string | null;
    phone: string | null;
    email?: string | null;
    status: string | null;
    tags?: unknown; // stored as Json in DB — cast to string[] when joining
    zaloName?: string | null; // resolved from Zalo API, not in DB
    // Extended fields (additive — all optional, B2 phase-03)
    createdAt?: Date | null;
    lastMessageAt?: Date | null;
    avatarUrl?: string | null;
    zaloGender?: string | null;
    zaloDob?: string | null;
    customAttrs?: Record<string, unknown>;
  } | null;
  conversation?: { id: string } | null;
}

const TEMPLATE_VARIABLES: Record<string, (context: AutomationTemplateContext) => string> = {
  // Contact fields
  'contact.fullName': (ctx) => ctx.contact?.fullName ?? '',
  'contact.phone': (ctx) => ctx.contact?.phone ?? '',
  'contact.email': (ctx) => ctx.contact?.email ?? '',
  'contact.status': (ctx) => ctx.contact?.status ?? '',
  'contact.crmName': (ctx) => ctx.contact?.crmName ?? ctx.contact?.fullName ?? '',
  'contact.zaloName': (ctx) => ctx.contact?.zaloName ?? ctx.contact?.fullName ?? '',
  'contact.tags': (ctx) => {
    const tags = ctx.contact?.tags;
    if (!tags) return '';
    if (Array.isArray(tags)) return (tags as string[]).join(', ');
    return '';
  },

  // Conversation fields
  'conversation.id': (ctx) => ctx.conversation?.id ?? '',

  // Org fields
  'org.name': (ctx) => ctx.org?.name ?? '',

  // Date/time helpers (Vietnamese locale)
  'date.today': () => new Intl.DateTimeFormat('vi-VN').format(new Date()),
  'date.now': () =>
    new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date()),
};

/** All variable names available for template authoring UI */
export const AVAILABLE_VARIABLES: string[] = Object.keys(TEMPLATE_VARIABLES);

export function renderMessageTemplate(content: string, context: AutomationTemplateContext): string {
  return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, token: string) => {
    const resolver = TEMPLATE_VARIABLES[token];
    return resolver ? resolver(context) : '';
  });
}

// ── B2 phase-03: Short-form aliases for FEATURE-08 single-brace {key} syntax ─
// ADDITIVE ONLY — do not modify or remove existing TEMPLATE_VARIABLES entries.
const SHORT_FORM_ALIASES: Record<string, (ctx: AutomationTemplateContext) => string> = {
  'crm_name': (ctx) => ctx.contact?.crmName ?? ctx.contact?.fullName ?? '',
  'zalo_name': (ctx) => ctx.contact?.zaloName ?? '',
  'phone': (ctx) => ctx.contact?.phone ?? '',
  'email': (ctx) => ctx.contact?.email ?? '',
  'tag': (ctx) =>
    Array.isArray(ctx.contact?.tags) ? (ctx.contact!.tags as string[]).join(', ') : '',
  'pipeline_status': (ctx) => ctx.contact?.status ?? '',
  'created_date': (ctx) =>
    ctx.contact?.createdAt
      ? new Intl.DateTimeFormat('vi-VN').format(ctx.contact.createdAt)
      : '',
  'last_message_date': (ctx) =>
    ctx.contact?.lastMessageAt
      ? new Intl.DateTimeFormat('vi-VN').format(ctx.contact.lastMessageAt)
      : '',
  'date': () => new Intl.DateTimeFormat('vi-VN').format(new Date()),
  'zalo_avatar': (ctx) => ctx.contact?.avatarUrl ?? '',
  'zalo_gender': (ctx) => ctx.contact?.zaloGender ?? '',
  'zalo_dob': (ctx) => ctx.contact?.zaloDob ?? '',
};

/**
 * Extended renderer that handles both `{{contact.x}}` (via renderMessageTemplate)
 * and single-brace `{key}` short-form aliases + custom attribute fallback.
 * Use this in B2 callers (block-renderer, drip-sender). Existing callers of
 * renderMessageTemplate are untouched.
 */
export function renderTemplateWithAttrs(
  content: string,
  ctx: AutomationTemplateContext,
): string {
  // First pass: existing {{contact.x}} style tokens
  let out = renderMessageTemplate(content, ctx);

  // Second pass: short-form {key} → alias resolver OR custom attr fallback
  out = out.replace(/\{([a-z][a-z0-9_]*)\}/g, (match, key: string) => {
    const resolver = SHORT_FORM_ALIASES[key];
    if (resolver) return resolver(ctx);
    const customAttrs = ctx.contact?.customAttrs;
    if (customAttrs && key in customAttrs) {
      return String(customAttrs[key] ?? '');
    }
    return match; // leave unmatched literal intact
  });

  return out;
}
