#!/usr/bin/env bash
#
# zalocrm-deploy.sh — Cài đặt / Nâng cấp ZaloCRM Community TỰ ĐỘNG.
#
# Một lệnh lo trọn: tự phát hiện CÀI MỚI hay NÂNG CẤP, backup DB trước khi nâng cấp,
# sinh .env (secret ngẫu nhiên) nếu chưa có, build + chạy Docker, migrate DB, rồi
# kiểm tra sức khoẻ. KHÔNG bao giờ xoá dữ liệu (không dùng `down -v`).
#
# Dùng:
#   ./scripts/zalocrm-deploy.sh            # tự phát hiện (auto)
#   ./scripts/zalocrm-deploy.sh install    # ép cài mới
#   ./scripts/zalocrm-deploy.sh upgrade    # ép nâng cấp (vd 3.3 → 3.4)
#   ./scripts/zalocrm-deploy.sh backup     # chỉ backup database rồi thoát
#
# Yêu cầu: Docker + Docker Compose v2, openssl. Chạy ở thư mục gốc mã nguồn.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="zalo-crm-app"; DB="zalo-crm-db"
CORE_SERVICES=(app db redis minio minio-init)   # clamav/backup là tuỳ chọn → không bật
PORT_DEFAULT="3080"

c_blue=$'\033[1;36m'; c_grn=$'\033[1;32m'; c_yel=$'\033[1;33m'; c_red=$'\033[1;31m'; c_off=$'\033[0m'
log()  { echo "${c_blue}▶${c_off} $*"; }
ok()   { echo "${c_grn}✓${c_off} $*"; }
warn() { echo "${c_yel}⚠${c_off}  $*"; }
die()  { echo "${c_red}✗ $*${c_off}" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "Thiếu '$1' — cài đặt trước khi chạy."; }

# set_env KEY VALUE — thay (hoặc thêm) dòng KEY=... trong .env. Truyền qua ENV để
# không vướng ký tự đặc biệt (/, :, #...) trong value.
set_env() {
  K="$1" V="$2" perl -i -pe 's/^\Q$ENV{K}\E=.*/"$ENV{K}=$ENV{V}"/e' .env
  grep -qE "^$1=" .env || printf '%s=%s\n' "$1" "$2" >> .env
}
env_val() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
gen() { openssl rand -hex "${1:-32}"; }

# ── Pre-flight ────────────────────────────────────────────────────────────────
need docker; need openssl
docker compose version >/dev/null 2>&1 || die "Cần Docker Compose v2 (lệnh 'docker compose')."
[ -f docker-compose.yml ] || die "Không thấy docker-compose.yml — chạy ở thư mục gốc mã nguồn ZaloCRM."

MODE="${1:-auto}"
DBUSER="$(env_val DB_USER)"; DBUSER="${DBUSER:-crmuser}"
DBNAME="$(env_val DB_NAME)"; DBNAME="${DBNAME:-zalocrm}"

# ── Sinh .env (cài mới) ───────────────────────────────────────────────────────
ensure_env() {
  [ -f .env ] && { ok ".env đã có — giữ nguyên (không ghi đè secret)."; return 0; }
  [ -f .env.example ] || die "Thiếu .env.example để tạo .env."
  log "Chưa có .env — tạo mới + sinh secret ngẫu nhiên…"
  cp .env.example .env
  local appurl="${APP_URL:-http://localhost:${PORT_DEFAULT}}"
  local s3pub="${S3_PUBLIC_URL:-http://localhost:9000/zalocrm-attachments}"
  local miniopw; miniopw="$(gen 16)"
  set_env JWT_SECRET          "$(gen 32)"
  set_env ENCRYPTION_KEY      "$(gen 32)"
  set_env DB_PASSWORD         "$(gen 16)"
  set_env MINIO_ROOT_USER     "zalocrm"
  set_env MINIO_ROOT_PASSWORD "$miniopw"
  set_env S3_ACCESS_KEY       "zalocrm"
  set_env S3_SECRET_KEY       "$miniopw"
  set_env S3_ENDPOINT         "http://minio:9000"
  set_env S3_BUCKET           "zalocrm-attachments"
  set_env S3_PUBLIC_URL       "$s3pub"
  set_env APP_URL             "$appurl"
  set_env CRM_LOGIN_URL       "$appurl"
  DBUSER="$(env_val DB_USER)"; DBUSER="${DBUSER:-crmuser}"
  DBNAME="$(env_val DB_NAME)"; DBNAME="${DBNAME:-zalocrm}"
  ok ".env đã tạo (JWT/ENCRYPTION/DB/MinIO sinh tự động)."
  warn "Production: sửa APP_URL='$appurl' và S3_PUBLIC_URL thành domain HTTPS thật, rồi chạy lại."
}

# ── Có phải bản đang chạy (để quyết cài mới vs nâng cấp)? ──────────────────────
is_existing() {
  docker inspect "$DB" >/dev/null 2>&1 || return 1
  local n; n="$(docker exec "$DB" psql -U "$DBUSER" -d "$DBNAME" -tAc "SELECT count(*) FROM users" 2>/dev/null || echo 0)"
  [ "${n:-0}" -gt 0 ] 2>/dev/null
}

backup_db() {
  docker inspect "$DB" >/dev/null 2>&1 || { warn "Chưa có DB container — bỏ qua backup."; return 0; }
  local f="backup-zalocrm-$(date +%F-%H%M).sql"
  log "Backup database → $f …"
  docker exec "$DB" pg_dump -U "$DBUSER" "$DBNAME" > "$f" || die "Backup thất bại."
  [ -s "$f" ] || die "File backup rỗng — DỪNG (không nâng cấp khi chưa có backup an toàn)."
  ok "Backup OK: $f ($(du -h "$f" | cut -f1))."
}

build_up() {
  log "Build + khởi động dịch vụ lõi (app db redis minio)…"
  docker compose up -d --build "${CORE_SERVICES[@]}"
}

wait_app() {
  log "Chờ app container sẵn sàng…"
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" = "true" ] && { ok "app đang chạy."; return 0; }
    docker inspect "$DB" >/dev/null 2>&1 && docker exec "$DB" pg_isready -U "$DBUSER" >/dev/null 2>&1 || true
  done
  die "app không khởi động được — xem: docker logs $APP"
}

migrate() {
  log "Áp migration database (prisma migrate deploy)…"
  docker exec "$APP" npx prisma migrate deploy || die "migrate thất bại — xem docker logs $APP"
  ok "Migration đã áp xong."
}

cutover() {
  # Nâng cấp: ép mọi user đăng nhập lại 1 lần (vô hiệu token cũ).
  log "Cutover: vô hiệu token cũ (user đăng nhập lại 1 lần)…"
  docker exec "$DB" psql -U "$DBUSER" -d "$DBNAME" \
    -c "UPDATE users SET jwt_token_version = jwt_token_version + 1;" >/dev/null 2>&1 || \
    warn "Bỏ qua cutover (không tăng được jwt_token_version)."
}

restart_app() { log "Khởi động lại app cho sạch…"; docker compose restart app >/dev/null; }

health() {
  local url; url="$(env_val APP_URL)"; url="${url:-http://localhost:${PORT_DEFAULT}}"
  log "Kiểm tra sức khoẻ…"
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT_DEFAULT}/" 2>/dev/null)" = "200" ] && break
    sleep 1 || true
  done
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT_DEFAULT}/" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && ok "App phục vụ OK (HTTP 200) tại http://localhost:${PORT_DEFAULT}" \
                       || warn "App chưa trả 200 (mã $code) — xem: docker logs $APP"
}

# ── Luồng chính ───────────────────────────────────────────────────────────────
case "$MODE" in
  backup) backup_db; exit 0 ;;
  auto)    is_existing && MODE=upgrade || MODE=install ;;
  install|upgrade) ;;
  *) die "Mode không hợp lệ: $MODE (auto|install|upgrade|backup)";;
esac

if [ "$MODE" = "install" ]; then
  echo "═══ CÀI MỚI ZaloCRM Community ═══"
  ensure_env
  build_up
  wait_app
  migrate
  restart_app
  health
  echo ""
  ok "HOÀN TẤT cài mới."
  echo "→ Mở http://localhost:${PORT_DEFAULT} → trang /setup tự hiện → tạo tổ chức + tài khoản chủ."
else
  echo "═══ NÂNG CẤP ZaloCRM Community (giữ dữ liệu) ═══"
  [ -f .env ] || die "Không thấy .env — đây không phải bản đang chạy. Dùng 'install' để cài mới."
  backup_db
  build_up         # up -d --build, KHÔNG -v → GIỮ database
  wait_app
  migrate
  cutover
  restart_app
  health
  echo ""
  ok "HOÀN TẤT nâng cấp. User cần đăng nhập lại 1 lần (đúng, do cutover)."
fi
