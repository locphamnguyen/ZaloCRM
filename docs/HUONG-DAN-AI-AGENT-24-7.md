# Hướng dẫn AI Agent 24/7 cho Zalo cá nhân

AI Agent tự trả lời khách nhắn vào nick Zalo cá nhân khi sale vắng mặt. Agent dùng nhà cung cấp AI và API key đã cấu hình ở **Cài đặt → Trợ lý AI**, còn cấu hình riêng nằm ở **Cài đặt → AI Agent 24/7**.

> ⚠️ **Rủi ro khoá nick.** ZaloCRM kết nối Zalo cá nhân qua thư viện không chính thức (zca-js). Zalo không cho phép tự động hoá tài khoản cá nhân, nên nick có thể bị hạn chế hoặc khoá. Hãy dùng **nick phụ**, giữ giới hạn thấp, và cân nhắc **Zalo OA** nếu muốn tự động hoá lâu dài.

## Agent làm gì

- Nghe tin khách gửi vào các nick được chọn (chỉ chat 1-1, không trả lời nhóm).
- **Chế độ "Ngoài giờ" (mặc định):** ngoài giờ làm thì trả lời sau 8–25 giây; trong giờ làm thì chờ sale 10 phút, sale chưa trả lời thì agent trả lời.
- **Chế độ "Mọi lúc":** trả lời mọi tin sau 8–25 giây.
- Khách nhắn nhiều tin liên tiếp thì agent gộp lại và trả lời một lần.
- Khách nhắc tới từ khoá như "gặp nhân viên", "khiếu nại", "đổi trả", "dị ứng" (hoặc AI tự thấy cần người thật): agent gửi câu chuyển tiếp **một lần**, đánh dấu hội thoại "chưa trả lời" để sale thấy, rồi im lặng 24 giờ với khách đó.
- Tin agent gửi hiện trong CRM với người gửi "AI Agent" (`sentVia = ai_agent`).

## Các lớp an toàn

| Lớp | Mặc định |
|---|---|
| Bật/tắt | **Tắt** cho tới khi admin bật |
| Nick áp dụng | Chỉ các nick được tick |
| Không nhắn chủ động | Chỉ trả lời khách vừa nhắn |
| Trễ như người gõ | 8–25 giây ngẫu nhiên |
| Trần mỗi nick | 15 tin/giờ, 120 tin/24h |
| Trần mỗi khách | 6 tin/24h |
| Sale vừa nhắn | Agent nhường 30 phút |
| Quota AI | Dùng chung quota "AI tối đa/ngày" của Trợ lý AI |
| Rate limiter hệ thống | Vẫn áp dụng trần SDK chung của nick |

## Chạy 24/7 trên VPS

Agent chạy bên trong backend ZaloCRM, nên chỉ cần ZaloCRM chạy liên tục.

1. **Thuê VPS** Ubuntu 22.04, tối thiểu 2 vCPU / 4 GB RAM / 40 GB SSD, đặt ở Việt Nam hoặc Singapore để IP gần người dùng Zalo.
2. **Cài ZaloCRM từ fork của bạn** (để có module này):
   ```bash
   git clone https://github.com/hadostore/zalocrm.git && cd zalocrm
   ./scripts/zalocrm-deploy.sh
   ```
   Script tự cài Docker, build, chạy `prisma migrate deploy` (tạo bảng `ai_agent_configs`). Các container có `restart: unless-stopped` nên tự chạy lại khi VPS khởi động lại.
3. Vào `http://IP-VPS:3080`, tạo tổ chức, rồi **đăng nhập nick Zalo phụ bằng QR** ở Tài khoản Zalo.
4. **Cài đặt → Trợ lý AI:** chọn nhà cung cấp (ví dụ Anthropic, model Claude Haiku cho rẻ và nhanh), dán API key, đặt "AI tối đa/ngày".
5. **Cài đặt → AI Agent 24/7:** tick nick, chọn chế độ, giờ làm, điền **Kiến thức** (sản phẩm, giá, link Shopee/TikTok Shop, chính sách), rồi bật agent và lưu.
6. Thử bằng một nick Zalo khác nhắn vào nick phụ ngoài giờ làm.

**Theo dõi:** trang AI Agent hiển thị số tin agent gửi và số lần chuyển nhân viên trong 24h. Log chi tiết: `docker logs -f <container-app> | grep ai-agent`.

## Giới hạn hiện tại

- Bộ hẹn giờ nằm trong RAM: nếu backend khởi động lại đúng lúc có tin đang chờ, tin đó sẽ không được agent trả lời (sale vẫn thấy ở bộ lọc "chưa trả lời").
- Agent chưa "nhìn" được ảnh khách gửi; gặp ảnh/file cần xem thì agent chuyển cho nhân viên.
- Chỉ trả lời chữ, chưa gửi ảnh sản phẩm hay sticker.
