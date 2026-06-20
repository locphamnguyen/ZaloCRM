// dedup-globalid-dryrun.mjs — XEM TRƯỚC (dry-run) + GỘP (--apply) các hồ sơ trùng
// globalId↔phone (FIX 2026-06-20). Chạy trong container:
//   docker exec -w /app zalo-crm-app node scripts/dedup-globalid-dryrun.mjs           # dry-run
//   docker exec -w /app zalo-crm-app node scripts/dedup-globalid-dryrun.mjs --apply   # gộp thật
//
// Dry-run: in bảng cặp sẽ gộp (import-secondary → gốc-Zalo-primary) + tên/SĐT/#hội thoại/
// #bám đuổi-job/globalId. KHÔNG mutate. --apply: gọi detectDuplicates() (đã có pre-pass
// backfill globalId-từ-Friend + auto-merge cùng globalId + flag ca mơ hồ).
// Dùng prisma ĐÃ CẤU HÌNH của app (Prisma 7 cần pg-adapter — không new PrismaClient() trần).
import { prisma } from '../dist/shared/database/prisma-client.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  // Cặp nghi trùng: contact KHÔNG globalId (import) + có Friend.globalId khớp 1 contact ALIVE khác (gốc Zalo).
  const rows = await prisma.$queryRaw`
    SELECT
      sec.id   AS secondary_id, sec.full_name AS secondary_name, sec.phone AS secondary_phone,
      pri.id   AS primary_id,   pri.full_name AS primary_name,   pri.phone AS primary_phone,
      f.zalo_global_id AS global_id,
      (SELECT COUNT(*) FROM conversations c WHERE c.contact_id = pri.id) AS primary_convs,
      (SELECT COUNT(*) FROM conversations c WHERE c.contact_id = sec.id) AS secondary_convs
    FROM contacts sec
    JOIN friends f ON f.contact_id = sec.id AND f.zalo_global_id IS NOT NULL
    JOIN contacts pri ON pri.zalo_global_id = f.zalo_global_id AND pri.merged_into IS NULL
                      AND pri.org_id = sec.org_id AND pri.id <> sec.id
    WHERE (sec.zalo_global_id IS NULL OR sec.zalo_global_id = '')
      AND sec.merged_into IS NULL
    GROUP BY sec.id, sec.full_name, sec.phone, pri.id, pri.full_name, pri.phone, f.zalo_global_id
    ORDER BY sec.created_at DESC
  `;

  console.log(`\n=== DEDUP DRY-RUN — ${rows.length} cặp nghi trùng (import → gốc Zalo) ===`);
  console.log('SECONDARY (import, gộp đi)            → PRIMARY (gốc Zalo, giữ lại)          | globalId | conv P/S');
  for (const r of rows) {
    const sec = `${(r.secondary_name||'?').slice(0,18).padEnd(18)} ${r.secondary_phone||'(no phone)'}`;
    const pri = `${(r.primary_name||'?').slice(0,18).padEnd(18)} ${r.primary_phone||'(no phone)'}`;
    console.log(`  ${sec.padEnd(38)} → ${pri.padEnd(36)} | ${String(r.global_id).slice(0,10)} | ${r.primary_convs}/${r.secondary_convs}`);
  }
  console.log(`\nTổng: ${rows.length} cặp. ${APPLY ? '>>> ĐANG ÁP DỤNG (--apply) <<<' : '(dry-run — thêm --apply để gộp thật)'}`);

  if (APPLY) {
    const { detectDuplicates } = await import('../dist/modules/contacts/duplicate-detector.js');
    console.log('Chạy detectDuplicates() (backfill globalId-từ-Friend + auto-merge cùng globalId + flag mơ hồ)...');
    await detectDuplicates();
    console.log('XONG. Kiểm lại bằng dry-run (số cặp còn lại nên = 0 hoặc chỉ ca mơ hồ đã flag).');
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
