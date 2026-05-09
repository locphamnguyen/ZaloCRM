# Phase 5 — Frontend completion (FRONTEND-FIRST với mock data)

Generated 2026-05-08 sau khi review độ hoàn thiện UI ~52% so với 3 mockup HTML (chat-smax-v3, contacts-approach-b-v3, friends-v2).

## Quyết định
- **D5**: FRONTEND-FIRST. Hoàn thiện UI shell với mock data; backend làm song song.
- **D6**: 1 PR lớn cuối cùng (~6 commits, ~3500 LOC). Branch `feat/ui-phase5`.

## Work blocks

### W1 — Cross-cutting infrastructure (~0.5d)
- `src/composables/use-toast.ts` — useToast() composable singleton
- `src/components/ui/ToastContainer.vue` — mount trong DefaultLayout, render queue
- `src/components/ui/CareStatusBadge.vue` — chip 9 enum, click cycle hoặc dropdown
- `src/components/ui/TagChipList.vue` — display chips + autocomplete add input

### W2 — ConversationList refactor (~0.7d)
- Bỏ template Vuetify cũ (v-text-field, v-btn-toggle, v-chip variant)
- Search box phẳng + label chip bar 9 chips top
- Conv item: avatar gradient + platform-mark Z + unread dot + tag-mini + status-pill + group-bg cam
- Giữ binding props: conversations, selectedId, loading, search, @select, @update:filters

### W3 — MessageThread refactor (~1.0d)
- Chat header: avatar wrap + gender badge + name + status pill + care status pill cycle + meta row + btn-action (✓ Đã KB / 🚀 Webhook) + 4 icon-btn (history, search, note, more)
- Messages area: msg-divider date, bubble checkmarks ✓ ✓✓, reaction display
- Input toolbar trên 13 icons: emoji/sticker/gif/attach/image/voice/video/template/quick/card BĐS/card KH/location/AI/translate
- Mount AISuggestBar giữa messages và input (cần slot hoặc tách input ra)
- Giữ binding: conversation, messages, sending, replyingTo, editingMessage, typing, AI props

### W4 — ChatContactPanel: 5 section còn thiếu (~1.0d)
1. **Per-nick state KB** — Đã KB / Đã gửi mời / Đang nhắn lạ / Là bạn N ngày / Tin in/out per pair
2. **Label Zalo native** — chip per-nick từ `friend.zaloLabels`
3. **Tag riêng nick × KH** — `friend.crmTagsPerNick` (per-pair tags) — mock data
4. **3 nick khác cũng chăm** — list nick còn lại với status pill
5. **Ghi chú** — textarea Ctrl+Enter để save vào `contact.notes`

AutomationCardList visible với mock cards (thay vì ẩn hoàn toàn).

### W5 — ContactsView child rows render 13 cột (~0.8d)
- Child rows render với mock data (aggregate Contact data, fake winner-badge cho row đầu)
- Cột master "Nick chăm": 4 chip count theo trạng thái KB (`🟢 N / 🟡 N / 🔵 N / ⚪ N`)
- Footer "+N nick khác đã KB" (collapsible nếu KH có >5 nick)
- Care status edit dropdown (clickable chip → popup chọn 9 enum)

### W6 — FriendsView: 2 cột mới + care 9 enum (~0.5d)
- Cột "Nick có log" (col 2 mockup) — số nick đã từng log với KH này, badge cấp lvl-2/3/4
- Cột "Auto" (col 14 mockup) — chip "F1: 3/4" hoặc "—" nếu không có
- Replace 7 enum care status hiện → 9 enum dùng `<CareStatusBadge>` shared
- Care status filter trong filter bar wire vào API param
- Tag chip filter wire vào API param

## Tổng work: ~4.5d dev FE

## Backend gaps (làm song song, không chặn FE)
1. `Friend.customerCareStatus String?` (9 enum) + migration
2. `Friend.crmTagsPerNick Json @default("[]")` + migration
3. `Friend.automations` relation
4. `GET /contacts/:id/friendships` — child rows source
5. `PATCH /friends/:id` — update care status, per-pair tags
6. `GET /contacts/:id/automations` & `GET /friends/:id/automations`
7. Multi-account filter (`accountIds IN array`)
8. `users` filter (lọc theo nhân viên trong FilterRail)
9. Webhook fire endpoint
10. seen_messages event hook (zca-js)

## Success criteria
- Type check pass: `npx vue-tsc --noEmit` exit 0
- Vite build pass: `npx vite build`
- Docker prod build pass: `docker compose build app`
- Smoke test live container: GET / 200, POST /api/v1/auth/login 401 JSON
- Mỗi work block 1 commit, branch feat/ui-phase5
- Mock data đánh dấu rõ trong code (`// MOCK: ...`) để dễ remove khi backend ready
