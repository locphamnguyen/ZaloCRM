#!/usr/bin/env bash
#
# scripts/deploy-local.sh — One-shot deploy code mới vào container zalo-crm-app
# đang chạy trên cùng máy. Workflow:
#   1. Backend: tsc compile → dist/
#   2. Frontend: vue-tsc + vite build → frontend/dist/
#   3. Copy backend dist + prisma schema vào container
#   4. Regen Prisma client trong container (nếu schema đổi)
#   5. Copy frontend build vào container's /app/static
#   6. Restart container
#
# Dùng khi: vừa edit code local, muốn deploy ngay sang container hot mà KHÔNG
# rebuild full Docker image (chậm). Chỉ phù hợp dev/staging cùng máy.
#
# Skip steps:
#   --skip-backend    bỏ qua compile + copy backend
#   --skip-frontend   bỏ qua build + copy frontend
#   --skip-prisma     bỏ qua regen prisma (khi không đổi schema)
#   --no-restart      không restart container (warning: code đã thay nhưng node
#                     vẫn giữ module cache cũ)

set -euo pipefail

# ─── Config ───
CONTAINER="${ZALOCRM_CONTAINER:-zalo-crm-app}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SKIP_BACKEND=0
SKIP_FRONTEND=0
SKIP_PRISMA=0
DO_RESTART=1

for arg in "$@"; do
  case "$arg" in
    --skip-backend)  SKIP_BACKEND=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --skip-prisma)   SKIP_PRISMA=1 ;;
    --no-restart)    DO_RESTART=0 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# *//'
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

# ─── Pre-flight ───
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "❌ Container '${CONTAINER}' không chạy. Khởi động trước: docker compose up -d" >&2
  exit 1
fi

step() { echo "▶ $1"; }
ok()   { echo "  ✓ $1"; }

# ─── 1. Backend compile ───
if [[ $SKIP_BACKEND -eq 0 ]]; then
  step "Backend: tsc compile"
  ( cd "$ROOT/backend" && npx tsc 2>&1 | tail -3 )
  ok "dist/ updated"

  step "Backend: copy dist/ → container /app/dist/"
  docker cp "$ROOT/backend/dist/." "$CONTAINER:/app/dist/" >/dev/null
  ok "copied"

  if [[ $SKIP_PRISMA -eq 0 ]]; then
    step "Prisma: copy schema + regen client trong container"
    docker cp "$ROOT/backend/prisma/schema.prisma" \
      "$CONTAINER:/app/prisma/schema.prisma" >/dev/null
    docker exec "$CONTAINER" sh -c 'cd /app && npx prisma generate' 2>&1 | tail -3
    ok "client regenerated"
  fi
fi

# ─── 2. Frontend build ───
if [[ $SKIP_FRONTEND -eq 0 ]]; then
  step "Frontend: vue-tsc + vite build"
  ( cd "$ROOT/frontend" && npm run build 2>&1 | tail -3 )
  ok "dist/ updated"

  step "Frontend: clean stale + copy dist/ → container /app/static/"
  # docker cp behaviors khó chịu:
  #   1. `cp parent/. → /static/` KHÔNG xoá file cũ + KHÔNG overwrite index.html
  #      (mtime preserved khiến server giữ bản cũ mặc dù content thay).
  #   2. Vite build mỗi lần ra hash mới (index-XXX.js) → container tích luỹ
  #      chunk cũ → index.html mới ref hash mới, nhưng nếu index.html không
  #      được overwrite → browser load hash CŨ → MIME error trắng trang.
  # Fix: wipe /app/static/ rồi copy lại sạch.
  docker exec "$CONTAINER" sh -c 'find /app/static -mindepth 1 -delete' >/dev/null 2>&1 || true
  docker cp "$ROOT/frontend/dist/." "$CONTAINER:/app/static/" >/dev/null
  # docker cp `parent/.` không tự re-tạo subdir nếu vừa bị xoá → copy assets explicit
  docker cp "$ROOT/frontend/dist/assets" "$CONTAINER:/app/static/" >/dev/null 2>&1 || true
  ok "copied (clean replace)"
fi

# ─── 3. Restart ───
if [[ $DO_RESTART -eq 1 ]]; then
  step "Restart container '$CONTAINER'"
  docker restart "$CONTAINER" >/dev/null
  sleep 4
  if docker logs "$CONTAINER" --tail 5 2>&1 | grep -qiE 'error|fatal'; then
    echo "⚠️  Container restart xong nhưng log có error. Check: docker logs $CONTAINER"
  fi
  ok "restarted"
else
  echo "ℹ️  Bỏ qua restart (--no-restart). Node module cache có thể giữ code cũ — restart thủ công nếu cần."
fi

echo ""
echo "✅ Deploy local xong. Hard-reload browser (Ctrl+Shift+R) để bypass cache JS chunk cũ."
