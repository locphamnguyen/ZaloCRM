# Design System: ZaloCRM

## 1. Visual Theme & Atmosphere

ZaloCRM is a workplace tool for teams that live inside customer conversations. The interface is built around one promise: *every message your business has ever received is one click away*. The visual language commits hard to **concentrated calm** — deep teal-navy as the dominant color, generous white space around the inbox, and an aggressive refusal to decorate. Chat moves fast; the chrome around it must not.

The typography is set in **Manrope** — a modern geometric grotesque with humanist details and full Vietnamese diacritics support. At display sizes (40–54px) it runs at weight 800 with tight negative tracking (-0.025em) so headlines feel structural rather than literary. At body sizes (15px) it sits at weight 500 with a comfortable 1.6 line height, calibrated to keep dense Vietnamese diacritics legible on long message threads. Mono is reserved for one job only — technical identifiers like conversation IDs, timestamps, and code tokens — set in JetBrains Mono.

The color story is monochromatic-with-a-pulse. The palette is essentially a teal-navy core (`#0E445A`, `#06222F`) and a metallic-blue accent (`#1786BE`, bright `#5BB8E5`) layered against a cool near-white paper (`#F7F9FC`). The deepest teal-navy carries the brand and the most important text; the metallic blue is rationed exclusively for interactive moments — the send button, the unread badge, the focus ring. There is no third brand color. If a screen needs visual weight, it gets there by stacking neutrals more densely, never by reaching for a new hue.

### Key Characteristics

- Manrope ExtraBold (800) for display, regular weight (500) for body — only 3 weights in active use (500, 600, 800)
- Teal-navy-first palette: `#0E445A` / `#06222F` is the dominant brand value, used for ~40% of pixels on any given screen
- Single chromatic accent: Metallic Blue (`#1786BE`) reserved for primary CTAs, focus states, and unread indicators
- 4px spacing grid — every padding/margin is a multiple of 4 with no exceptions
- Soft teal-tinted shadows instead of true black, keeping elevation in-palette
- Chat-bubble metaphor everywhere — the logo, message rows, the empty state, the loading skeleton all rhyme with a rounded-square-with-tail silhouette
- **Monochrome logo**: a single ink with the Z glyph and status dot knocked out (transparent) so the mark reads as one flat stamp on any background
- Vietnamese-first copy with diacritics-tested line heights; no italic for emphasis (replaced by weight 600)
- Pill-shaped chips and circular avatars for high-frequency UI; rectangular cards with 14px radius for content

## 2. Color Palette & Roles

### Brand

- **Teal Navy** (`#0E445A` → `#06222F`): The defining color. Dark surfaces, sidebar, top-nav, primary text, outgoing message bubble, logo ink. The product looks teal-navy because it is. Use the gradient `150deg, #0E445A, #06222F` for large brand surfaces.
- **Metallic Blue** (`#1786BE`): The interactive accent. Primary CTAs, focus rings, unread badges, the status dot on avatars, links. *This is the only color allowed to shout.*
- **Blue 600 / 700** (`#0F6FA0` / `#0B5880`): Hover and pressed states for metallic-blue elements, link emphasis, secondary-button text. The bridge values between Metallic and Teal Navy.
- **Sky Bright** (`#5BB8E5`): The light tint of the accent — wordmark/dot on dark backgrounds, the active-tab underline, decorative highlights on hero panels.
- **Blue Soft** (`#E4F1F8`): The lightest tint of the brand. Secondary button background, selected-row background, chip background, divider on light surfaces.

### Neutrals

- **Ink** (`#141A24`): Primary body text. Slightly warmer than pure black for long-form reading.
- **Ink 2** (`#475066`): Secondary headings, table cell content, lead paragraph copy.
- **Ink 3** (`#6B7488`): Secondary text, description copy, the "subline" beneath a contact name.
- **Ink 4** (`#97A0B3`): Placeholder text, disabled icons, metadata, the "less important" tier.
- **Line** (`#E7EAF0`): Default border on cards, inputs, and table cells.
- **Line 2** (`#EEF1F6`): Internal dividers within cards, separators between message bubbles in the same thread.
- **Surface 2** (`#F7F9FC`): Secondary surface — the conversation list background, the empty-state canvas.
- **Surface 3** (`#F1F4F9`): Page background behind cards.
- **White** (`#FFFFFF`): Card background, primary surface, incoming bubble.

### Semantic

- **Success** (`#12B76A`): "Closed deal", "Resolved", "Message delivered" — moments of completion.
- **Warning** (`#F5A524`): "Awaiting reply", "SLA at risk".
- **Error** (`#F04438`): "Complaint", "Failed to send", destructive actions.
- **Info**: Aliased to Metallic Blue (`#1786BE`) — informational chips share the brand accent intentionally to keep "this is happening now" consistent with "this is interactive".

### Chat Bubble Colors

The two-color bubble rule is sacred and never broken:

- **Incoming (customer):** background `#FFFFFF`, text `#141A24`, border `#E7EAF0`, asymmetric radius `4px 16px 16px 16px` (sharp corner at top-left).
- **Outgoing (agent):** background `#0E445A`, text `#FFFFFF`, no border, asymmetric radius `16px 4px 16px 16px` (sharp corner at top-right).

## 3. Typography Rules

### Font Families

- **Display & Body:** `Manrope`, fallback: `'Inter', 'Segoe UI', Helvetica, Arial, sans-serif`. Loaded with weights 400, 500, 600, 700, 800.
- **Mono:** `JetBrains Mono`, fallback: `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`. Loaded at 400, 500, 600.
- **No serif**, no script, no italic. Emphasis is achieved via weight (500 → 600) or color (mute → ink), never via italic or font swap.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|---|---|---|---|---|---|---|
| Display Hero (H1) | Manrope | 54px | 800 | 1.06 | -0.025em | Marketing hero, billboard moments |
| Section Heading (H2) | Manrope | 34px | 800 | 1.10 | -0.02em | Page titles in the app, "Inbox", "Reports" |
| Sub-section (H3) | Manrope | 28px | 700 | 1.20 | -0.015em | Card titles, section dividers |
| Card Title (H4) | Manrope | 22px | 700 | 1.30 | -0.01em | Conversation header name |
| Inline Heading (H5) | Manrope | 18px | 700 | 1.40 | -0.005em | Group labels, sidebar section titles |
| Body Large | Manrope | 17px | 500 | 1.55 | 0 | Lead paragraph, expanded message view |
| Body | Manrope | 15px | 500 | 1.60 | 0 | Default text, message bubble, table cells |
| Body Small | Manrope | 13px | 500 | 1.55 | 0 | Conversation preview lines, metadata |
| Caption | Manrope | 12px | 600 | 1.45 | 0.02em | Timestamps, "Đã xem", micro labels |
| Overline | Manrope | 11px | 700 | 1.40 | 0.16em | UPPERCASE section eyebrows, column headers |
| Mono | JetBrains Mono | 13px | 500 | 1.55 | 0 | conversationId, phone numbers, code |

### Principles

- **Vietnamese-first metrics**: stacked diacritics (e.g. `ặ`, `ờ`, `ễ`) need vertical room. Body line-height never goes below 1.55. Headlines compress more (1.06–1.20) only because they are single-line in 95% of layouts.
- **Weight as hierarchy**: only four weights — 500 (default body), 600 (emphasized body, captions), 700 (sub-headings, table headers), 800 (display). 400 and 900 are not in active use.
- **Negative tracking only at large sizes**: headlines tighten to -0.025em → -0.005em. Body and below sit at 0 tracking. Negative tracking on body makes Vietnamese diacritics collide.
- **Mono is data, never decoration**: JetBrains Mono only when the value is technically meaningful (an ID, a number, a phone number, an API key). Don't use mono "for vibes".
- **Number figures**: body uses proportional figures; tables and dashboards switch on `font-variant-numeric: tabular-nums`.

## 4. Component Stylings

### Logo

The logo is **monochrome** — one ink for both the bubble mark and the "ZaloCRM" wordmark. The Z glyph and the status dot are knocked out of the bubble (transparent), so whatever sits behind the mark shows through the negative space.

- Primary ink on light backgrounds: Teal Navy `#0E445A` (or `#06222F`)
- Reversed ink on dark backgrounds: White `#FFFFFF`
- Single-ink print / emboss / watermark: any one brand ink, no second color
- The Z is optically centered in the bubble (equal top/bottom breathing room); the status dot keeps a ~2.5px transparent gap from the bubble edge
- At ≤24px, ship a dedicated "solid" favicon (Z and dot filled, no knockout) so the thin negative space doesn't disappear
- Never reintroduce the two-tone (navy + blue) treatment, never add a second color, never fill the knockouts

### Buttons

**Primary (Metallic)** — the workhorse CTA ("Gửi tin nhắn", "Lưu nháp", "Tạo hội thoại").

- Background: `#1786BE` · Text: `#FFFFFF` · Radius: `10px`
- Padding: `12px 20px` (md) — height resolves to ~40px, hitting touch-target minimums
- Font: Manrope 14px / weight 600 / no tracking
- Hover: background → `#0F6FA0`. No transform, no shadow change.
- Focus: `0 0 0 4px rgba(23,134,190,0.18)` ring (Metallic at 18%)
- Disabled: `#E4F1F8` background, `#97A0B3` text, no hover

**Secondary (Blue Soft)** — second action when paired with Primary.

- Background: `#E4F1F8` · Text: `#0B5880` · Radius: `10px`
- Hover: background → `#d3e9f5`

**Ghost** — tertiary actions ("Huỷ", "Đóng").

- Background: transparent · Text: `#475066` · Border: `1px solid #E7EAF0` · Radius: `10px`
- Hover: background → `#F7F9FC`

**Semantic (Success / Error)** — status-changing actions ("Đã giải quyết", "Xoá hội thoại"). Identical shape to Primary, only fill changes (`#12B76A` / `#F04438`).

**Size Scale**: `sm` (7px / 14px, 12.5px text), `md` (12px / 20px, 14px text, default), `lg` (14px / 26px, 16px text). Padding is asymmetric (more horizontal than vertical) at every size.

### Inputs

- Padding: `11px 14px` · Radius: `10px` · Border: `1px solid #E7EAF0`
- Background: `#FFFFFF` · Text: `#141A24` · Placeholder: `#97A0B3`
- Focus: border becomes `#1786BE` + ring `0 0 0 4px rgba(23,134,190,0.16)`
- Error: border `#F04438`, helper text in `#F04438`
- Inputs and buttons share the same height (~40px at `md`) so they sit on the same row without alignment hacks

### Cards

- Background: `#FFFFFF` · Border: `1px solid #E7EAF0` · Radius: `14px`
- Padding: `28px` (lg) for primary content cards, `16px–22px` for compact cards
- No shadow by default. Elevation comes from the 1px border against the `#F1F4F9` page background.
- Optional shadow for floating cards (modals, dropdowns): `0 12px 30px rgba(14,68,90,0.14)`

### Chips & Tags

- Radius: `999px` (pill) — distinct from buttons (10px) so the role read is instant
- Padding: `6px 13px` · Font: 12.5px / weight 600
- 5 variants: *neutral / info* (Blue Soft bg + `#0B5880` text), *success* (mint tint), *warning* (amber tint), *error* (rose tint)
- Optional leading dot: 7px circle in the chip's accent color

### Chat Bubbles

The single most repeated component. Specs are non-negotiable:

- **Incoming bubble**: `#FFFFFF` bg + `1px solid #E7EAF0` border. Radius `4px 16px 16px 16px`. Padding `11px 15px`. Text 14px / weight 500.
- **Outgoing bubble**: `#0E445A` bg + no border. Radius `16px 4px 16px 16px`. Same padding and font, text white.
- **Max width**: 80% of the conversation panel — bubbles never span full width.
- **Stack spacing**: 4px between bubbles from the same sender, 16px when sender changes.
- **Meta line**: 11px Ink-4, 5px below bubble. Format: *name · time · status*.

### Avatar

- Default: 42×42 circle, solid Teal Navy `#0E445A` background, initials in white 14px / weight 700
- Sizes: 24, 28, 30, 42 (default), 64
- Status dot: 12px circle (success/warning color) with 2px white border, anchored bottom-right
- Group avatars: stack 3 with -8px overlap and 2px white border each

### Navigation (Top-nav)

- Height: 54px, background gradient `180deg, #0E445A, #06222F`
- Brand: 26px monochrome mark (white ink) + "Zalo" white / "CRM" `#5BB8E5`
- Item: 12.5px text, `#c4cbd9` default, white when active
- Active state: `rgba(91,184,229,0.16)` background pill + `2px` `#5BB8E5` bottom underline
- Section labels (in side panels): 11px Overline (uppercase, tracked +0.14em) in Ink-3

## 5. Layout Principles

### Spacing System (4px grid)

Every padding, margin, and gap is a multiple of 4. The named scale:

```
space-1 = 4px      space-2 = 8px      space-3 = 12px
space-4 = 16px     space-5 = 20px     space-6 = 24px
space-8 = 32px     space-10 = 40px    space-12 = 48px
space-16 = 64px    space-20 = 80px    space-24 = 96px
```

Use `space-4` (16px) and `space-6` (24px) as defaults. `space-2` (8px) for related elements (icon + label), `space-8` (32px) for grouped sections within a card, `space-12+` (48px+) for separating top-level page sections.

### Grid & Container

- App shell: top-nav + flexible content area, or a 268px sidebar + content for docs. No max-width on the main conversation panel.
- Settings / marketing pages: max-width 1000–1100px, centered with generous horizontal padding
- Conversation reading width: 720px max for the message column
- Card grids: 2-column at <1100px viewport, 3–4 column above for KPI tiles. Keep ≤4 per row.

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `r-xs` | 4px | Inline tags, micro-pills inside bubbles |
| `r-sm` | 6px | Small buttons, badge backgrounds |
| `r-md` | 10px | Standard buttons, inputs, dropdowns |
| `r-lg` | 14px | Cards, panels, modals |
| `r-xl` | 20px | Hero cards, large promo panels |
| `r-pill` | 999px | Chips, tags, avatar, segmented controls |

Asymmetric radii are only used on chat bubbles (the tail corner shrinks to 4px). Never apply asymmetric radius elsewhere.

### Whitespace Philosophy

The app is dense by necessity — agents handle dozens of conversations a shift. But the rhythm should still breathe: 24px between cards in a grid, 16px between sections inside a card, 8px between a label and its input. We aim for *structured density*.

## 6. Depth & Elevation

| Level | Treatment | Use |
|---|---|---|
| Flat (0) | No shadow, border only | Default cards, page sections, nav |
| Shadow 1 | `0 1px 2px rgba(14,68,90,.06), 0 1px 1px rgba(14,68,90,.04)` | Floating action button, sticky toolbars |
| Shadow 2 | `0 4px 12px rgba(14,68,90,.10), 0 1px 3px rgba(14,68,90,.06)` | Dropdowns, popovers, tooltips |
| Shadow 3 | `0 12px 30px rgba(14,68,90,.14), 0 4px 10px rgba(14,68,90,.08)` | Modals, command palette, overlays |
| Focus ring | `0 0 0 4px rgba(23,134,190,.18)` | Every keyboard-focusable element |

**Shadow Philosophy**: shadows are *teal-tinted*, never pure black. The base color of all shadows is `rgba(14, 68, 90, x)` — the same Teal Navy that anchors the rest of the system. This keeps elevation feeling like it belongs to the palette. Most surfaces have no shadow at all; they earn separation from the page through a 1px border against the Surface background.

## 7. Do's and Don'ts

### Do

- Use Teal Navy `#0E445A` / `#06222F` as the dominant color on every screen — it's the brand voice
- Reserve Metallic Blue `#1786BE` exclusively for interactive elements (primary buttons, focus rings, unread badges, links)
- Keep the logo **monochrome** — one ink, Z and dot knocked out. Teal-navy on light, white on dark.
- Set body text in Manrope weight 500 at 15px / line-height 1.6 — calibrated for Vietnamese readability
- Snap every spacing value to the 4px grid (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96)
- Use the two-color chat bubble rule: white incoming, teal-navy outgoing — no exceptions, no theming
- Anchor card separation with a 1px `#E7EAF0` border on a `#F1F4F9` page background, not with shadows
- Tint shadows with teal-navy (`rgba(14, 68, 90, x)`) instead of pure black so elevation stays in-palette
- Use 10px radius on buttons/inputs, 14px on cards, 999px on chips — keep the three radii roles distinct
- Show conversation IDs, phone numbers, and timestamps in JetBrains Mono — they are *data*, not *copy*

### Don't

- Don't reintroduce a third brand color. The chromatic budget is Teal Navy + Metallic Blue and that's the whole story.
- Don't bring back the two-tone logo or fill the Z/dot knockouts — the mark is monochrome now.
- Don't use italic for emphasis — use weight 600 instead. Italics break poorly with Vietnamese diacritics.
- Don't go below 1.55 line-height on body text. Stacked Vietnamese marks need the vertical room.
- Don't use pure black (`#000000`) anywhere. Even our darkest text (`#141A24`) carries a hint of navy.
- Don't apply gradients to UI surfaces. Gradients are only allowed on (1) avatar/brand surfaces and (2) marketing hero panels.
- Don't use heavy weights below 14px — small text in 700/800 looks chunky. Use 600 max under 14px.
- Don't add hover transforms (scale, translate). Hover changes color only.
- Don't break the bubble color rule. Incoming bubbles are always white-on-light, outgoing always teal-navy.
- Don't use mono for "developer aesthetic". Mono = data only.

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 640px | Top-nav collapses to bottom bar (5 icons max). Single-pane: list OR conversation. Cards full-bleed. |
| Tablet | 640–1024px | Sidebar in icon-only mode (64px). 2-pane: list + active conversation. |
| Desktop | 1024–1440px | Sidebar expanded (268px). 3-pane: nav + list + conversation. Detail panel behind a toggle. |
| Wide | > 1440px | 3-pane + persistent contact detail panel (320px). Conversation caps at 720px reading width. |

### Touch Targets

- Primary actions: minimum 44×44px
- List rows on mobile: 56px tall (avatar + 2 lines of preview)
- Icon-only buttons: 40×40px container holding a 20px icon
- Send-message button on mobile: 48×48px Metallic-filled circle, bottom-right of composer

### Collapsing Strategy

- Headlines: Display Hero 54px → 40px on tablet → 32px on mobile, line-height stays at 1.06–1.15
- 3-column card grids → 2-column at 1100px → single column at 700px
- Tables: full table at desktop → card-list view at <900px
- Sidebar: 268px expanded → 64px icon → hidden on mobile (replaced by bottom nav)
- Modals: centered card on desktop → bottom sheet on mobile

### Density Modes

Two density settings (user preference, persisted in localStorage):

- **Comfortable (default)**: list rows 64px, card padding 28px, button padding 12px/20px
- **Compact**: list rows 48px, card padding 20px, button padding 7px/16px — for power users handling 100+ threads per shift

## 9. Agent Prompt Guide

### Quick Color Reference

- Primary CTA: Metallic `#1786BE` on white text, OR Teal Navy `#0E445A` on white text (Metallic for emphasis, Teal Navy for app chrome)
- Page background (light): `#F1F4F9`
- Card surface: `#FFFFFF` · Secondary surface: `#F7F9FC`
- Heading text: `#0E445A` (brand-tinted) or `#141A24` (neutral)
- Body text: `#141A24` primary, `#6B7488` secondary
- Border: `#E7EAF0` default, `#EEF1F6` soft
- Focus ring: `0 0 0 4px rgba(23,134,190,0.18)`
- Card shadow (rare): `0 4px 12px rgba(14,68,90,0.10)`

### Example Component Prompts

- "Build a conversation list row: 64px height, white background with 1px `#EEF1F6` bottom border. Left: 42px teal-navy avatar with online status dot. Middle: contact name in Manrope 14px / 700 / `#0E445A`, preview line below in 13px / 500 / `#6B7488` truncated. Right: timestamp in 12px Ink-4, unread badge — Metallic `#1786BE` filled circle with white number, 18px diameter."
- "Design the message composer: white card with 1px `#E7EAF0` top border, 16px padding. Multi-line textarea no border, 14px text, placeholder `#97A0B3`. Right: 40px circular Metallic `#1786BE` button with white paper-plane icon. Above: a 32px toolbar with attachment/emoji/template icons in `#6B7488`, hover to `#0E445A`."
- "Create the empty inbox state: centered. Top: 96px monochrome ZaloCRM mark (Teal Navy `#0E445A`) at 30% opacity. Middle: H3 'Chưa có hội thoại nào' in `#0E445A`. Below: Body 15px `#6B7488` 'Tin nhắn mới sẽ xuất hiện ở đây.' Bottom: Metallic primary button 'Bắt đầu hội thoại mới'."
- "Build a contact detail card: 320px width, white, 14px radius, 1px `#E7EAF0` border, 28px padding. Top: 64px avatar + name in H4 + Ink-4 metadata. Divider `#EEF1F6`. Then a 2-column key/value table: label in 12px Caption uppercase + value in 14px body Ink. 12px row gap, 24px column gap."

### Iteration Guide

1. Start every screen with a `#F1F4F9` page background and 24px outer padding
2. Drop content into 14px-radius white cards with `#E7EAF0` borders — never start with shadows
3. Pick exactly one Metallic `#1786BE` moment per screen (the primary CTA, or the unread state, or the focus ring — not all three)
4. Set every text element using the type scale role names. If unsure, use Body 15px / weight 500
5. Snap all paddings/margins/gaps to the 4px grid
6. Validate with Vietnamese sample copy that includes stacked diacritics: *"Trần Thị Hồng đặt 2 áo phông cỡ XL màu xám tro lúc 14:32 hôm nay."* — if anything clips, increase line-height before reducing font size
7. Test focus states with Tab. Every interactive element must show the Metallic focus ring.
8. Keep the logo monochrome and run the screen through the Do/Don't checklist in section 7 before considering it done

---

*ZaloCRM Design System · v2.0 · palette HS Holding · monochrome logo · last updated 13/06/2026 · maintained by the design & platform team.*
