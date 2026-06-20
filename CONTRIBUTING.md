# Đóng góp cho ZaloCRM

Cảm ơn bạn đã quan tâm đóng góp! Tài liệu này mô tả quy trình và các điều kiện pháp lý.

Mã nguồn công khai: <https://github.com/locphamnguyen/ZaloCRM>

## Giấy phép đóng góp

ZaloCRM phát hành theo **GNU AGPL-3.0** (xem [LICENSE](LICENSE)). **Khi gửi đóng góp, bạn đồng ý
phát hành đóng góp đó theo AGPL-3.0** và chấp nhận **2 yêu cầu** dưới đây.

### 1. CLA (Contributor License Agreement) — bắt buộc
Dự án dùng **dual-license** (AGPL + thương mại), nên cần bạn ký **CLA** cấp cho người bảo trì quyền
phát hành đóng góp của bạn theo cả AGPL lẫn giấy phép thương mại.

- Lần đầu mở Pull Request, **bot CLA-assistant** sẽ tự bình luận với link ký. Ký 1 lần là dùng cho mọi PR sau.
- PR **chưa ký CLA sẽ không được merge**.

### 2. DCO (Developer Certificate of Origin) — bắt buộc
Mỗi commit phải có dòng **`Signed-off-by`** chứng nhận bạn có quyền đóng góp (xem [DCO](DCO)):

```bash
git commit -s -m "feat: mô tả thay đổi"
# → tự thêm: Signed-off-by: Tên Bạn <email@example.com>
```
Cấu hình `git config user.name` / `user.email` đúng trước khi commit.

## Quy trình

1. **Fork** `locphamnguyen/ZaloCRM` → tạo branch từ nhánh chính: `git checkout -b feat/ten-tinh-nang`.
2. Code + **chạy kiểm tra trước khi gửi**:
   ```bash
   (cd backend && npx tsc --noEmit)      # backend typecheck
   (cd frontend && npx vue-tsc -b)       # frontend typecheck
   (cd frontend && npm run build)        # build thật (bắt lỗi SFC/CSS)
   ```
3. Commit theo **Conventional Commits** + `-s` (DCO):
   `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:` …
4. Mở **Pull Request** về `locphamnguyen/ZaloCRM`, mô tả rõ thay đổi + cách kiểm thử. Ký CLA khi bot nhắc.

## Quy ước code

- TypeScript strict; backend NodeNext (import `.js` extension). Vue 3 `<script setup>`.
- Mỗi file nguồn mới giữ **SPDX header**:
  ```
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026 Nguyễn Tiến Lộc
  ```
  (file `.vue` dùng `<!-- ... -->`).
- **KHÔNG commit secrets** — `.env` đã được `.gitignore`. Dùng `.env.example` làm mẫu.
- Viết code theo phong cách sẵn có của file xung quanh (naming, comment, idiom).

## Báo lỗi / đề xuất

Mở **Issue** trên `locphamnguyen/ZaloCRM` với: mô tả, bước tái hiện, log/ảnh, môi trường (OS, Docker, version).
Lỗi bảo mật: gửi riêng email **locnt@locnguyendata.com** (đừng mở issue công khai).

## Giấy phép thương mại

Muốn dùng ZaloCRM không chịu ràng buộc copyleft của AGPL (nhúng vào sản phẩm đóng, SaaS độc quyền…):
liên hệ **locnt@locnguyendata.com**.
