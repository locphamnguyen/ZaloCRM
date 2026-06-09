/**
 * seed-project-blocks.mjs — Tạo 4 folder dự án (public) × 15 Khối tin nhắn mẫu mỗi dự án.
 * Anh chốt 2026-06-09. Chạy TRONG container: node /app/dist + Prisma + text-formatter.
 *
 * Mỗi Khối (send_message) = 2 thành phần:
 *   1. Chào: "{gender} {name}" (PLAIN — giữ biến cá nhân hoá, gửi sẽ render)
 *   2. Thân: nội dung tư vấn có markup đậm/màu (KHÔNG biến → giữ format khi gửi)
 *
 * Markup hỗ trợ (text-formatter): **đậm** *nghiêng* {red}{orange}{yellow}{green}{blue}
 *   {big}{small} {underline}  # H1  ## H2  - bullet  > trích
 *
 * Idempotent: bỏ qua folder đã tồn tại (theo tên + orgId).
 */
import { prisma } from '../shared/database/prisma-client.js';
import { formatMessage } from '../shared/text-formatter.js';
import { toZaloStyles } from '../modules/system-notifications/welcome-message-builder.js';

const ORG_ID = process.env.SEED_ORG_ID;
const CREATED_BY = process.env.SEED_USER_ID;
if (!ORG_ID || !CREATED_BY) {
  console.error('Thiếu SEED_ORG_ID / SEED_USER_ID env');
  process.exit(1);
}

// Compile markup → {text, styles} mã Zalo (giữ format).
function compile(markup) {
  const f = formatMessage(markup);
  return { text: f.text, styles: toZaloStyles(f.styles) };
}

// 1 Khối: chào (plain) + thân (markup). cat = phân loại để gắn tag.
function block(name, cat, bodyMarkup, greeting = '{gender} {name},') {
  const greetC = { kind: 'text', defaultVariant: { text: greeting, styles: [] }, variants: [] };
  const body = compile(bodyMarkup);
  const bodyC = { kind: 'text', defaultVariant: { text: body.text, styles: body.styles }, variants: [] };
  return { name, cat, content: { components: [greetC, bodyC] } };
}

// ─── 4 dự án — mỗi dự án 15 mẫu (hỏi / gửi thông tin / pháp lý) ───
// cat: 'hoi' = hỏi khai thác nhu cầu, 'tt' = gửi thông tin, 'pl' = pháp lý/cam kết.

const PROJECTS = [
  {
    folder: 'Emerald Garden View',
    blocks: [
      block('EGV · Chào mở đầu tư vấn', 'hoi',
`Em là {sale}, chuyên viên tư vấn dự án **Emerald Garden View**. 🌿
Để tư vấn căn phù hợp nhất, cho em hỏi {gender} đang quan tâm:
- Loại căn: *1PN / 2PN / 3PN* ?
- Tầm ngân sách dự kiến?
- Mua **ở** hay **đầu tư cho thuê**?`,
        'Dạ {gender} {name} ơi,'),
      block('EGV · Hỏi nhu cầu diện tích', 'hoi',
`Dạ để em chọn đúng căn, {gender} cho em biết gia đình mình mấy người ở ạ?
- **2-3 người** → căn *2PN ~65m²* rất hợp lý
- **4 người trở lên** → nên xem *3PN ~88m²* cho thoải mái`),
      block('EGV · Hỏi thời điểm mua', 'hoi',
`Dạ {gender} dự định mua trong khoảng thời gian nào ạ?
Hiện CĐT đang có {orange}chính sách ưu đãi giai đoạn đầu{/orange} — em báo {gender} kịp đợt tốt nhất.`),
      block('EGV · Bảng giá tổng quan', 'tt',
`# 🏢 Emerald Garden View
**Giá bán từ:** {red}2,9 tỷ/căn 2PN{/red}
**Diện tích:** 65 – 88 m²
**Thanh toán:** chỉ {green}30% ký HĐMB{/green}, còn lại theo tiến độ
**Bàn giao:** Quý 4/2026 — full nội thất cơ bản`),
      block('EGV · Vị trí & tiện ích', 'tt',
`📍 **Vị trí Emerald Garden View**
- Mặt tiền đường lớn, 5 phút tới trung tâm
- {green}Công viên nội khu 2ha{/green} + hồ cảnh quan
- Hồ bơi, gym, khu BBQ, trường mầm non nội khu
> Không gian sống xanh giữa lòng thành phố.`),
      block('EGV · Chính sách thanh toán', 'tt',
`💳 **Chính sách thanh toán — Emerald Garden View**
- Ký HĐMB: {green}30%{/green}
- Theo tiến độ: 40% (chia 6 đợt nhẹ)
- Nhận nhà: 25%
- {orange}Chiết khấu 3%{/orange} khi thanh toán nhanh`),
      block('EGV · Ưu đãi hiện tại', 'tt',
`🎁 **Ưu đãi tháng này — Emerald Garden View**
- {red}Chiết khấu tới 5%{/red} cho 20 khách đầu
- Tặng *gói nội thất 50 triệu*
- Hỗ trợ vay {blue}70% – lãi suất 0% trong 18 tháng{/blue}`),
      block('EGV · So sánh căn 2PN vs 3PN', 'tt',
`So sánh nhanh giúp {gender} dễ chọn ạ:
**2PN (65m²)** — {green}từ 2,9 tỷ{/green}, hợp gia đình trẻ
**3PN (88m²)** — {green}từ 3,8 tỷ{/green}, hợp gia đình 4-5 người
Cả 2 đều có *ban công view công viên*.`),
      block('EGV · Tiềm năng cho thuê', 'tt',
`📈 **Tiềm năng đầu tư — Emerald Garden View**
- Giá cho thuê dự kiến: {green}12–15 triệu/tháng{/green}
- Tỷ suất ~ {orange}5–6%/năm{/orange}
- Khu dân trí cao, nhu cầu thuê ổn định`),
      block('EGV · Mời xem nhà mẫu', 'hoi',
`Dạ {gender} sắp xếp được *cuối tuần này* qua xem **nhà mẫu** không ạ?
Em đặt lịch riêng, có xe đưa đón. {gender} thuận sáng hay chiều ạ?`),
      block('EGV · Pháp lý dự án', 'pl',
`# ⚖️ Pháp lý Emerald Garden View
- {green}Sổ hồng riêng từng căn{/green}
- Đã có **Giấy phép xây dựng** + nghiệm thu PCCC
- CĐT uy tín, đã bàn giao nhiều dự án đúng hẹn
> {gender} hoàn toàn yên tâm về pháp lý ạ.`),
      block('EGV · Cam kết hợp đồng', 'pl',
`📄 **Cam kết trong HĐMB — Emerald Garden View**
- Tiến độ bàn giao ghi rõ trong hợp đồng
- {red}Phạt chậm bàn giao theo lãi suất ngân hàng{/red}
- Bảo hành căn hộ **5 năm** kết cấu`),
      block('EGV · Hỗ trợ vay ngân hàng', 'pl',
`🏦 **Hỗ trợ vay — Emerald Garden View**
- Liên kết {blue}3 ngân hàng lớn{/blue}
- Vay tối đa {green}70% giá trị căn{/green}
- Ân hạn gốc + {orange}lãi 0% 18 tháng{/orange}
- Em hỗ trợ hồ sơ vay từ A-Z ạ.`),
      block('EGV · Giải đáp lo ngại tiến độ', 'pl',
`Dạ về lo ngại tiến độ, em xin chia sẻ ạ:
- Dự án đã thi công {green}đến tầng 12{/green} đúng kế hoạch
- Có **camera giám sát công trường** cập nhật hàng tuần
- Em gửi {gender} hình ảnh tiến độ mới nhất nhé.`),
      block('EGV · Chốt & giữ chỗ', 'tt',
`Dạ căn đẹp tại **Emerald Garden View** còn rất ít ạ.
Để giữ căn ưng ý, {gender} chỉ cần {red}đặt cọc giữ chỗ 50 triệu{/red} (hoàn lại nếu đổi ý trong 7 ngày).
Em gửi {gender} *bảng hàng còn lại* ngay nhé! 🌟`),
    ],
  },
  {
    folder: 'Emerald Boulevard',
    blocks: [
      block('EB · Chào mở đầu tư vấn', 'hoi',
`Em là {sale}, tư vấn dự án **Emerald Boulevard** — khu shophouse & căn hộ mặt đại lộ. 🏙️
{gender} đang quan tâm sản phẩm nào ạ:
- *Căn hộ ở*
- *Shophouse kinh doanh*
- *Đầu tư dòng tiền*`,
        'Dạ {gender} {name} thân mến,'),
      block('EB · Hỏi mục đích đầu tư', 'hoi',
`Dạ {gender} mua để **ở**, **kinh doanh** hay **đầu tư cho thuê** ạ?
Mỗi mục đích em sẽ tư vấn vị trí căn khác nhau để tối ưu nhất cho {gender}.`),
      block('EB · Hỏi ngân sách shophouse', 'hoi',
`Dạ với shophouse mặt đại lộ, tầm đầu tư {gender} dự kiến khoảng bao nhiêu ạ?
Em có các căn từ {green}6 tỷ{/green} (góc) đến {green}12 tỷ{/green} (mặt tiền chính).`),
      block('EB · Bảng giá tổng quan', 'tt',
`# 🏙️ Emerald Boulevard
**Căn hộ:** từ {red}3,2 tỷ{/red} (2PN)
**Shophouse:** từ {red}6 tỷ{/red}
**Mặt tiền:** đại lộ 40m sầm uất
**Bàn giao:** Quý 2/2027`),
      block('EB · Lợi thế shophouse', 'tt',
`🛍️ **Lợi thế Shophouse Emerald Boulevard**
- Mặt tiền {orange}đại lộ 40m{/orange} — lưu lượng cao
- {green}Vừa ở vừa kinh doanh{/green}
- Tệp dân cư 5.000+ căn hộ xung quanh
> Dòng tiền cho thuê mặt bằng cực tốt.`),
      block('EB · Tiện ích nội khu', 'tt',
`✨ **Tiện ích Emerald Boulevard**
- Trung tâm thương mại nội khu
- Phố đi bộ, quảng trường nhạc nước
- {green}Hồ bơi tràn bờ tầng cao{/green} + gym view đại lộ`),
      block('EB · Chính sách thanh toán', 'tt',
`💳 **Thanh toán — Emerald Boulevard**
- Ký HĐ: {green}20%{/green} (giãn nhẹ giai đoạn đầu)
- Tiến độ: 50%
- Nhận nhà: 30%
- {orange}Ưu đãi 4%{/orange} thanh toán sớm`),
      block('EB · Tiềm năng cho thuê shophouse', 'tt',
`📈 **Dòng tiền Shophouse Emerald Boulevard**
- Cho thuê mặt bằng: {green}40–60 triệu/tháng{/green}
- Hoàn vốn dự kiến *8–10 năm*
- Giá trị tăng theo mật độ dân cư`),
      block('EB · So sánh tầng & hướng', 'tt',
`Dạ {gender} tham khảo lựa chọn ạ:
**Tầng thấp** — {green}giá tốt hơn{/green}, tiện đi lại
**Tầng cao** — *view đại lộ về đêm rất đẹp*
Hướng Đông Nam đón gió mát, em ưu tiên giữ cho {gender}.`),
      block('EB · Mời tham quan thực tế', 'hoi',
`Dạ mời {gender} qua tham quan **đại lộ thực tế** + nhà mẫu cuối tuần ạ.
Em đặt lịch riêng cho {gender}, có chuyên viên dẫn xem từng căn. {gender} rảnh hôm nào ạ?`),
      block('EB · Pháp lý dự án', 'pl',
`# ⚖️ Pháp lý Emerald Boulevard
- {green}Sổ hồng lâu dài cho căn hộ{/green}
- Shophouse: {green}sở hữu lâu dài{/green}
- Đầy đủ **GPXD, phê duyệt 1/500, PCCC**
> Pháp lý minh bạch, {gender} an tâm ạ.`),
      block('EB · Cam kết bàn giao', 'pl',
`📄 **Cam kết — Emerald Boulevard**
- Bàn giao đúng tiến độ ghi trong HĐMB
- {red}Bồi thường nếu chậm bàn giao{/red}
- Bảo hành kết cấu **5 năm**, thấm dột **2 năm**`),
      block('EB · Hỗ trợ vay & ân hạn', 'pl',
`🏦 **Hỗ trợ tài chính — Emerald Boulevard**
- Vay tới {green}65%{/green} qua ngân hàng liên kết
- {orange}Ân hạn gốc & lãi 24 tháng{/orange}
- Em làm hồ sơ vay giúp {gender} miễn phí.`),
      block('EB · Giải đáp về dòng tiền', 'pl',
`Dạ về lo ngại lấp đầy mặt bằng, em chia sẻ ạ:
- Khu đã có {green}sẵn 3.000 cư dân{/green} về ở
- CĐT cam kết **hỗ trợ kết nối khách thuê**
- Em gửi {gender} danh sách thương hiệu đã thuê nhé.`),
      block('EB · Chốt & giữ chỗ', 'tt',
`Dạ căn shophouse vị trí đẹp tại **Emerald Boulevard** rất khan hiếm.
{gender} đặt {red}cọc thiện chí 100 triệu{/red} để em khoá căn (hoàn lại nếu không ký HĐ).
Em gửi {gender} *sơ đồ căn còn lại* ngay ạ! 🏙️`),
    ],
  },
  {
    folder: 'Emerald River Park',
    blocks: [
      block('ERP · Chào mở đầu tư vấn', 'hoi',
`Em là {sale}, tư vấn dự án **Emerald River Park** — căn hộ ven sông view triệu đô. 🌊
{gender} đang tìm căn để *ở* hay *đầu tư* ạ? Và {gender} thích **view sông** hay **view nội khu** hơn?`,
        'Dạ {gender} {name} kính mến,'),
      block('ERP · Hỏi sở thích view', 'hoi',
`Dạ điểm đặc biệt của Emerald River Park là {blue}view sông{/blue}.
{gender} thích:
- *View sông trực diện* (cao cấp hơn)
- *View hồ bơi / công viên* (giá mềm hơn)
Em tư vấn căn hợp gu {gender} nhất ạ.`),
      block('ERP · Hỏi ngân sách', 'hoi',
`Dạ {gender} cho em biết tầm ngân sách để em lọc căn phù hợp ạ.
Dự án có từ {green}2,5 tỷ{/green} (1PN view nội khu) đến {green}5,5 tỷ{/green} (3PN view sông).`),
      block('ERP · Bảng giá tổng quan', 'tt',
`# 🌊 Emerald River Park
**1PN:** từ {red}2,5 tỷ{/red}
**2PN:** từ {red}3,6 tỷ{/red}
**3PN view sông:** từ {red}5,5 tỷ{/red}
**Bàn giao:** Quý 1/2027 — bàn giao cao cấp`),
      block('ERP · Điểm nhấn ven sông', 'tt',
`🌅 **Điểm nhấn Emerald River Park**
- {blue}Mặt tiền sông 300m{/blue} — công viên ven sông
- Bến du thuyền nội khu
- {green}80% căn có view sông/hồ{/green}
> Sống chill mỗi ngày như đi nghỉ dưỡng.`),
      block('ERP · Tiện ích nghỉ dưỡng', 'tt',
`🏊 **Tiện ích Emerald River Park**
- Hồ bơi vô cực hướng sông
- Đường dạo bộ ven sông 1,2km
- Spa, yoga, khu BBQ ngoài trời
- {green}Công viên ánh sáng về đêm{/green}`),
      block('ERP · Chính sách thanh toán', 'tt',
`💳 **Thanh toán — Emerald River Park**
- Ký HĐ: {green}25%{/green}
- Tiến độ: 45%
- Nhận nhà: 30%
- {orange}Chiết khấu 3,5%{/orange} thanh toán nhanh`),
      block('ERP · Ưu đãi đặt chỗ sớm', 'tt',
`🎁 **Ưu đãi Emerald River Park**
- {red}Chiết khấu 6%{/red} cho 30 khách đầu
- Tặng {orange}voucher nội thất 80 triệu{/orange}
- Bốc thăm *chuyến du lịch nghỉ dưỡng*`),
      block('ERP · Tiềm năng tăng giá', 'tt',
`📈 **Tiềm năng — Emerald River Park**
- Quỹ đất ven sông {orange}ngày càng khan hiếm{/orange}
- Giá căn ven sông thường {green}tăng 8–12%/năm{/green}
- Cho thuê: 14–18 triệu/tháng`),
      block('ERP · Mời trải nghiệm thực tế', 'hoi',
`Dạ {gender} qua trải nghiệm **không gian ven sông** thực tế nhé.
Em mời {gender} cà phê tại nhà mẫu view sông, có chuyên viên tư vấn riêng. {gender} chọn ngày nào ạ?`),
      block('ERP · Pháp lý dự án', 'pl',
`# ⚖️ Pháp lý Emerald River Park
- {green}Sổ hồng riêng từng căn{/green}
- Đầy đủ pháp lý: **1/500, GPXD, PCCC**
- Đất ở lâu dài, không vướng quy hoạch
> {gender} yên tâm tuyệt đối về pháp lý ạ.`),
      block('ERP · Cam kết chất lượng bàn giao', 'pl',
`📄 **Cam kết — Emerald River Park**
- Bàn giao {green}thiết bị nhập khẩu cao cấp{/green}
- Đúng tiến độ HĐMB, {red}phạt chậm rõ ràng{/red}
- Bảo hành kết cấu **5 năm**`),
      block('ERP · Hỗ trợ vay ngân hàng', 'pl',
`🏦 **Hỗ trợ vay — Emerald River Park**
- Vay tới {green}70%{/green}, {orange}lãi 0% 12 tháng{/orange}
- Liên kết {blue}ngân hàng lớn{/blue}, duyệt nhanh
- Em hỗ trợ trọn gói hồ sơ cho {gender}.`),
      block('ERP · Giải đáp lo ngại ngập/ven sông', 'pl',
`Dạ về lo ngại ven sông, em chia sẻ ạ:
- Dự án {green}tôn nền cao + hệ thống thoát nước riêng{/green}
- Kè sông kiên cố theo chuẩn
- Em gửi {gender} *hồ sơ kỹ thuật hạ tầng* để {gender} an tâm.`),
      block('ERP · Chốt & giữ căn view sông', 'tt',
`Dạ căn **view sông trực diện** tại Emerald River Park còn rất ít ạ.
{gender} giữ chỗ {red}cọc 50 triệu{/red} để em khoá căn đẹp (linh hoạt hoàn cọc).
Em gửi {gender} *bảng căn view sông còn lại* ngay nhé! 🌊`),
    ],
  },
  {
    folder: 'Monrei Sài Gòn',
    blocks: [
      block('MSG · Chào mở đầu tư vấn', 'hoi',
`Em là {sale}, tư vấn dự án căn hộ cao cấp **Monrei Sài Gòn** — phong cách Resort giữa trung tâm. 🌴
Dạ {gender} đang quan tâm để *an cư* hay *đầu tư* ạ? Em tư vấn dòng căn phù hợp nhất.`,
        'Dạ {gender} {name} thân mến,'),
      block('MSG · Hỏi gu sống', 'hoi',
`Dạ Monrei Sài Gòn hướng tới phong cách **nghỉ dưỡng tại gia**.
{gender} ưu tiên điều gì nhất ạ:
- *Không gian xanh, yên tĩnh*
- *Tiện ích resort 5 sao*
- *Vị trí kết nối trung tâm*`),
      block('MSG · Hỏi ngân sách & loại căn', 'hoi',
`Dạ {gender} dự tính khoảng ngân sách bao nhiêu và mấy phòng ngủ ạ?
Monrei có {green}Studio từ 2,2 tỷ{/green} đến {green}Sky Villa 3PN từ 7 tỷ{/green}.`),
      block('MSG · Bảng giá tổng quan', 'tt',
`# 🌴 Monrei Sài Gòn
**Studio:** từ {red}2,2 tỷ{/red}
**2PN:** từ {red}3,9 tỷ{/red}
**Sky Villa 3PN:** từ {red}7 tỷ{/red}
**Bàn giao:** Quý 3/2027 — *bàn giao cao cấp full nội thất*`),
      block('MSG · Phong cách resort', 'tt',
`🌴 **Phong cách Resort — Monrei Sài Gòn**
- {green}Mật độ xây dựng chỉ 28%{/green} — phủ xanh tối đa
- Hồ bơi muối khoáng, vườn nhiệt đới
- {orange}Sảnh đón chuẩn khách sạn 5 sao{/orange}
> Mỗi ngày về nhà như đi nghỉ dưỡng.`),
      block('MSG · Vị trí kết nối', 'tt',
`📍 **Vị trí Monrei Sài Gòn**
- {green}10 phút tới trung tâm Quận 1{/green}
- Gần tuyến Metro, trường quốc tế
- Bao quanh tiện ích: bệnh viện, TTTM`),
      block('MSG · Chính sách thanh toán', 'tt',
`💳 **Thanh toán — Monrei Sài Gòn**
- Ký HĐ: {green}15%{/green} (giãn cực nhẹ)
- Tiến độ: 50% (nhiều đợt nhỏ)
- Nhận nhà: 35%
- {orange}Chiết khấu 4%{/orange} thanh toán sớm`),
      block('MSG · Ưu đãi giới hạn', 'tt',
`🎁 **Ưu đãi Monrei Sài Gòn**
- {red}Chiết khấu tới 7%{/red} đợt mở bán đầu
- Tặng {orange}gói nội thất cao cấp 100 triệu{/orange}
- Miễn {green}2 năm phí quản lý{/green}`),
      block('MSG · Tiềm năng đầu tư', 'tt',
`📈 **Tiềm năng — Monrei Sài Gòn**
- Căn hộ cao cấp trung tâm {orange}luôn giữ giá{/orange}
- Cho thuê chuyên gia: {green}18–25 triệu/tháng{/green}
- Thanh khoản cao nhờ vị trí lõi`),
      block('MSG · Mời xem nhà mẫu 5 sao', 'hoi',
`Dạ mời {gender} qua trải nghiệm **nhà mẫu chuẩn resort** của Monrei Sài Gòn ạ.
Em sắp lịch riêng, đón tiếp như khách VIP. {gender} thuận sáng hay chiều cuối tuần ạ?`),
      block('MSG · Pháp lý dự án', 'pl',
`# ⚖️ Pháp lý Monrei Sài Gòn
- {green}Sổ hồng sở hữu lâu dài{/green}
- CĐT lớn, pháp lý hoàn chỉnh: **1/500, GPXD, PCCC**
- Đã đủ điều kiện mở bán theo luật
> {gender} hoàn toàn an tâm ạ.`),
      block('MSG · Cam kết & bảo hành', 'pl',
`📄 **Cam kết — Monrei Sài Gòn**
- Bàn giao {green}đúng thiết kế & vật liệu cam kết{/green}
- {red}Phạt chậm bàn giao theo HĐMB{/red}
- Bảo hành kết cấu **5 năm**, thiết bị **2 năm**`),
      block('MSG · Hỗ trợ vay cao cấp', 'pl',
`🏦 **Hỗ trợ tài chính — Monrei Sài Gòn**
- Vay tới {green}70%{/green} giá trị căn
- {orange}Ân hạn gốc + lãi 0% trong 24 tháng{/orange}
- Em làm hồ sơ vay trọn gói cho {gender}.`),
      block('MSG · Giải đáp lo ngại giá cao', 'pl',
`Dạ về băn khoăn mức giá, em xin chia sẻ ạ:
- Đây là dòng {orange}căn hộ hàng hiệu{/orange}, giá trị bền vững
- So với khu vực, Monrei còn {green}dư địa tăng giá{/green}
- Em gửi {gender} *bảng so sánh giá khu vực* để {gender} cân nhắc ạ.`),
      block('MSG · Chốt & ưu tiên giữ căn', 'tt',
`Dạ những căn đẹp tại **Monrei Sài Gòn** được giữ rất nhanh ạ.
{gender} đặt {red}cọc ưu tiên 50 triệu{/red} để em khoá căn + chốt mức ưu đãi tốt nhất (hoàn cọc linh hoạt).
Em gửi {gender} *bảng hàng & ưu đãi* ngay nhé! 🌴`),
    ],
  },
];

const CAT_TAGS = { hoi: '#hỏi-nhu-cầu', tt: '#gửi-thông-tin', pl: '#pháp-lý' };

async function main() {
  let folderCreated = 0;
  let blockCreated = 0;
  let skipped = 0;

  for (const proj of PROJECTS) {
    // Folder idempotent theo (orgId, name)
    let folder = await prisma.blockFolder.findFirst({
      where: { orgId: ORG_ID, name: proj.folder },
    });
    if (folder) {
      console.log(`[skip folder] "${proj.folder}" đã tồn tại (${folder.id})`);
    } else {
      folder = await prisma.blockFolder.create({
        data: {
          orgId: ORG_ID,
          name: proj.folder,
          visibility: 'public',
          createdById: CREATED_BY,
        },
      });
      folderCreated++;
      console.log(`[folder] tạo "${proj.folder}" (${folder.id}) — public`);
    }

    for (const b of proj.blocks) {
      const exists = await prisma.block.findFirst({
        where: { orgId: ORG_ID, folderId: folder.id, name: b.name },
        select: { id: true },
      });
      if (exists) {
        skipped++;
        continue;
      }
      await prisma.block.create({
        data: {
          orgId: ORG_ID,
          folderId: folder.id,
          name: b.name,
          channel: 'zalo_user',
          actionType: 'send_message',
          content: b.content,
          tagIds: [CAT_TAGS[b.cat], `#${proj.folder.replace(/\s+/g, '')}`],
          isShared: true,
          createdById: CREATED_BY,
        },
      });
      blockCreated++;
    }
  }

  console.log(`\n✅ XONG: folder mới=${folderCreated}, block mới=${blockCreated}, bỏ qua (đã có)=${skipped}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('LỖI seed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
