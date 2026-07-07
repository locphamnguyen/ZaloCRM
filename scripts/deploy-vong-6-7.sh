#!/usr/bin/env bash
# Deploy vòng 6 (tin chào sau kết bạn) + vòng 7 (nguồn Bạn bè cho Broadcast)
# Chạy TRÊN SERVER, tại thư mục dự án (vd /opt/ZaloCRM-CorepViet).
set -euo pipefail

echo "==> 1. Backup database trước khi migrate"
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > "backup-truoc-vong67-$(date +%Y%m%d-%H%M).sql"

echo "==> 2. Lấy code mới nhất từ GitHub"
git fetch origin
git checkout main
git pull origin main

echo "==> 3. Rebuild app"
docker compose up -d --build app

echo "==> 4. Áp 2 migration mới (welcome message + broadcast source friends)"
docker exec zalo-crm-app npx prisma migrate deploy

echo "==> 5. Restart app"
docker compose restart app

echo "==> 6. Verify — phải thấy log cron broadcast + target"
sleep 5
docker logs zalo-crm-app --tail 40 | grep -E "broadcast-cron|target-cron|listener|cron" || true
curl -fsS http://localhost:3080/ >/dev/null && echo "HTTP 200 OK" || echo "CẢNH BÁO: app chưa trả 200, xem log"

echo "==> Xong. Kiểm tra trên giao diện: Marketing → Broadcast (2 tab nguồn) + Mục tiêu (tick Tin chào)."
