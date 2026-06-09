/**
 * update-block-greetings.mjs — Sửa câu chào mở đầu (component[0]) của 45 Khối tư vấn,
 * mỗi câu dẫn riêng theo nội dung khối thay vì "{gender} {name}," rập khuôn (Anh báo nhàm).
 * GIỮ NGUYÊN component[1] (thân tin + styles). Anh chốt 2026-06-09: 1 câu/khối, có {gender}{name}.
 *
 * Chạy trong container: node /app/dist/scripts/, env SEED_ORG_ID.
 * Map theo TÊN khối chính xác. 15 khối "Chào mở đầu" KHÔNG đụng (đã có câu riêng).
 */
import { prisma } from '../shared/database/prisma-client.js';

const ORG_ID = process.env.SEED_ORG_ID;
if (!ORG_ID) { console.error('Thiếu SEED_ORG_ID'); process.exit(1); }

// Map: tên Khối → câu chào mở đầu mới (dẫn vào đúng chủ đề). Giữ {gender} {name}.
// Đa dạng giọng: hỏi nhẹ, mở thông tin, dẫn pháp lý, chốt thúc... không lặp cấu trúc.
const GREETINGS = {
  // ───────── Emerald Garden View ─────────
  'EGV · Hỏi nhu cầu diện tích': 'Dạ {gender} {name} ơi, để em chọn đúng căn diện tích vừa ý, em hỏi {gender} chút xíu nha 😊',
  'EGV · Hỏi thời điểm mua': 'Dạ {gender} {name}, tiện đây em hỏi nhanh để canh đúng đợt ưu đãi tốt nhất cho mình nhé ⏰',
  'EGV · Bảng giá tổng quan': 'Dạ {gender} {name} ơi, em gửi {gender} bảng giá Emerald Garden View cập nhật mới nhất nè 👇',
  'EGV · Vị trí & tiện ích': 'Dạ {gender} {name}, em khoe {gender} chút về vị trí & không gian sống ở đây nha 🌿',
  'EGV · Chính sách thanh toán': 'Dạ {gender} {name} ơi, phần thanh toán nhẹ nhàng lắm, em tóm tắt cho {gender} dễ hình dung ạ 💳',
  'EGV · Ưu đãi hiện tại': 'Dạ {gender} {name}, đang có ưu đãi rất tốt mà em sợ {gender} bỏ lỡ, em báo liền nha 🎁',
  'EGV · So sánh căn 2PN vs 3PN': 'Dạ {gender} {name} ơi, để {gender} dễ quyết, em so sánh nhanh 2 loại căn cho mình xem nè 🤔',
  'EGV · Tiềm năng cho thuê': 'Dạ {gender} {name}, nếu {gender} tính đầu tư thì con số dòng tiền này đáng để xem ạ 📈',
  'EGV · Mời xem nhà mẫu': 'Dạ {gender} {name} ơi, nói gì cũng không bằng tận mắt, em mời {gender} ghé nhà mẫu nha 🏡',
  'EGV · Pháp lý dự án': 'Dạ về pháp lý mà {gender} {name} quan tâm, em xin chia sẻ rõ ràng để {gender} an tâm ạ ⚖️',
  'EGV · Cam kết hợp đồng': 'Dạ {gender} {name}, những gì CĐT cam kết đều ghi rõ trong hợp đồng, em nói {gender} nghe ạ 📄',
  'EGV · Hỗ trợ vay ngân hàng': 'Dạ {gender} {name} ơi, đừng lo phần tài chính, có gói vay này hỗ trợ mình rất nhiều ạ 🏦',
  'EGV · Giải đáp lo ngại tiến độ': 'Dạ {gender} {name}, em hiểu {gender} băn khoăn về tiến độ, em cập nhật tình hình thực tế ạ 🏗️',
  'EGV · Chốt & giữ chỗ': 'Dạ {gender} {name} ơi, căn đẹp đang vơi dần, em nhắn {gender} kẻo tiếc nha 🌟',

  // ───────── Emerald Boulevard ─────────
  'EB · Hỏi mục đích đầu tư': 'Dạ {gender} {name} ơi, để tư vấn đúng vị trí căn, em hỏi {gender} mục đích mua nhé 😊',
  'EB · Hỏi ngân sách shophouse': 'Dạ {gender} {name}, shophouse có nhiều tầm giá, em hỏi ngân sách để lọc căn hợp với {gender} ạ',
  'EB · Bảng giá tổng quan': 'Dạ {gender} {name} ơi, em gửi {gender} bảng giá Emerald Boulevard nha 👇',
  'EB · Lợi thế shophouse': 'Dạ {gender} {name}, vì sao shophouse ở đây hot, em chỉ {gender} mấy điểm ăn tiền nè 🛍️',
  'EB · Tiện ích nội khu': 'Dạ {gender} {name} ơi, sống ở Boulevard thì tiện ích quanh nhà cực đã, em khoe {gender} chút ✨',
  'EB · Chính sách thanh toán': 'Dạ {gender} {name}, lịch thanh toán giãn rất nhẹ, em tóm tắt cho {gender} dễ theo ạ 💳',
  'EB · Tiềm năng cho thuê shophouse': 'Dạ {gender} {name} ơi, nói về dòng tiền cho thuê thì shophouse này đáng đồng tiền lắm ạ 📈',
  'EB · So sánh tầng & hướng': 'Dạ {gender} {name}, để {gender} chọn căn ưng nhất, em gợi ý vài lựa chọn tầng & hướng nha 🧭',
  'EB · Mời tham quan thực tế': 'Dạ {gender} {name} ơi, em mời {gender} ra xem mặt tiền đại lộ thực tế cho dễ cảm nhận nha 🏙️',
  'EB · Pháp lý dự án': 'Dạ phần pháp lý {gender} {name} cứ yên tâm, em trình bày rõ để mình nắm ạ ⚖️',
  'EB · Cam kết bàn giao': 'Dạ {gender} {name}, về cam kết bàn giao em nói thẳng để {gender} hoàn toàn yên tâm ạ 📄',
  'EB · Hỗ trợ vay & ân hạn': 'Dạ {gender} {name} ơi, gói vay & ân hạn ở đây dễ thở lắm, em chia sẻ với {gender} ạ 🏦',
  'EB · Giải đáp về dòng tiền': 'Dạ {gender} {name}, em hiểu {gender} lo chuyện lấp đầy mặt bằng, em nói rõ thực tế nha 💡',
  'EB · Chốt & giữ chỗ': 'Dạ {gender} {name} ơi, căn shophouse vị trí đẹp khan lắm, em giữ giúp {gender} kẻo lỡ nha 🏙️',

  // ───────── Emerald River Park ─────────
  'ERP · Hỏi sở thích view': 'Dạ {gender} {name} ơi, dự án nổi nhất là view sông, em hỏi gu của {gender} để chọn căn đẹp nhất nha 🌊',
  'ERP · Hỏi ngân sách': 'Dạ {gender} {name}, để em lọc căn vừa túi, {gender} cho em biết tầm ngân sách nhé 😊',
  'ERP · Bảng giá tổng quan': 'Dạ {gender} {name} ơi, em gửi {gender} bảng giá Emerald River Park nè 👇',
  'ERP · Điểm nhấn ven sông': 'Dạ {gender} {name}, điểm em mê nhất ở đây là không gian ven sông, em kể {gender} nghe nha 🌅',
  'ERP · Tiện ích nghỉ dưỡng': 'Dạ {gender} {name} ơi, ở đây sống như đi resort mỗi ngày, em khoe {gender} tiện ích nha 🏊',
  'ERP · Chính sách thanh toán': 'Dạ {gender} {name}, em tóm tắt lịch thanh toán cho {gender} dễ tính toán ạ 💳',
  'ERP · Ưu đãi đặt chỗ sớm': 'Dạ {gender} {name} ơi, đặt sớm đang có quà rất hời, em báo {gender} cho kịp nha 🎁',
  'ERP · Tiềm năng tăng giá': 'Dạ {gender} {name}, đất ven sông ngày càng hiếm, em chia sẻ {gender} góc nhìn đầu tư ạ 📈',
  'ERP · Mời trải nghiệm thực tế': 'Dạ {gender} {name} ơi, em mời {gender} ra cảm nhận không khí ven sông tận nơi nha ☕',
  'ERP · Pháp lý dự án': 'Dạ phần pháp lý {gender} {name} cứ an tâm, em trình bày rõ cho mình nắm ạ ⚖️',
  'ERP · Cam kết chất lượng bàn giao': 'Dạ {gender} {name}, về chất lượng bàn giao em cam kết rõ để {gender} yên tâm ạ 📄',
  'ERP · Hỗ trợ vay ngân hàng': 'Dạ {gender} {name} ơi, phần vay vốn có hỗ trợ tốt lắm, em nói {gender} nghe ạ 🏦',
  'ERP · Giải đáp lo ngại ngập/ven sông': 'Dạ {gender} {name}, em hiểu {gender} lo chuyện ven sông, em nói rõ về hạ tầng nha 💡',
  'ERP · Chốt & giữ căn view sông': 'Dạ {gender} {name} ơi, căn view sông đẹp còn rất ít, em giữ giúp {gender} kẻo tiếc nha 🌊',

  // ───────── Monrei Sài Gòn ─────────
  'MSG · Hỏi gu sống': 'Dạ {gender} {name} ơi, Monrei hướng tới sống nghỉ dưỡng, em hỏi gu của {gender} để tư vấn hợp nhất nha 🌴',
  'MSG · Hỏi ngân sách & loại căn': 'Dạ {gender} {name}, để chọn đúng căn cho {gender}, em hỏi nhanh ngân sách & số phòng nhé 😊',
  'MSG · Bảng giá tổng quan': 'Dạ {gender} {name} ơi, em gửi {gender} bảng giá Monrei Sài Gòn nè 👇',
  'MSG · Phong cách resort': 'Dạ {gender} {name}, điều khiến em thích Monrei nhất là phong cách resort, em kể {gender} nghe nha 🌴',
  'MSG · Vị trí kết nối': 'Dạ {gender} {name} ơi, vị trí kết nối của Monrei tiện cực, em chia sẻ với {gender} ạ 📍',
  'MSG · Chính sách thanh toán': 'Dạ {gender} {name}, lịch thanh toán giãn rất nhẹ, em tóm tắt cho {gender} ạ 💳',
  'MSG · Ưu đãi giới hạn': 'Dạ {gender} {name} ơi, đợt mở bán đầu có ưu đãi hiếm lắm, em báo {gender} ngay nha 🎁',
  'MSG · Tiềm năng đầu tư': 'Dạ {gender} {name}, căn cao cấp trung tâm luôn giữ giá, em chia sẻ {gender} góc đầu tư ạ 📈',
  'MSG · Mời xem nhà mẫu 5 sao': 'Dạ {gender} {name} ơi, em mời {gender} ghé trải nghiệm nhà mẫu chuẩn resort nha ✨',
  'MSG · Pháp lý dự án': 'Dạ phần pháp lý {gender} {name} cứ yên tâm, em trình bày minh bạch cho mình nắm ạ ⚖️',
  'MSG · Cam kết & bảo hành': 'Dạ {gender} {name}, về cam kết & bảo hành em nói rõ để {gender} hoàn toàn an tâm ạ 📄',
  'MSG · Hỗ trợ vay cao cấp': 'Dạ {gender} {name} ơi, gói vay ở đây ưu đãi rất tốt, em chia sẻ với {gender} ạ 🏦',
  'MSG · Giải đáp lo ngại giá cao': 'Dạ {gender} {name}, em hiểu {gender} cân nhắc về giá, em phân tích để {gender} thấy xứng đáng ạ 💡',
  'MSG · Chốt & ưu tiên giữ căn': 'Dạ {gender} {name} ơi, căn đẹp ở Monrei được giữ rất nhanh, em ưu tiên cho {gender} nha 🌴',
};

async function main() {
  let updated = 0, missing = 0, skipped = 0;
  for (const [blockName, greeting] of Object.entries(GREETINGS)) {
    const b = await prisma.block.findFirst({
      where: { orgId: ORG_ID, name: blockName, actionType: 'send_message' },
      select: { id: true, content: true },
    });
    if (!b) { console.log(`[MISS] không thấy "${blockName}"`); missing++; continue; }
    const content = b.content;
    const comps = Array.isArray(content?.components) ? content.components : [];
    if (comps.length < 2 || comps[0]?.kind !== 'text') {
      console.log(`[SKIP] "${blockName}" shape lạ`); skipped++; continue;
    }
    // CHỈ sửa câu chào (component[0]); giữ nguyên thân tin + styles.
    comps[0] = { ...comps[0], defaultVariant: { text: greeting, styles: [] }, variants: [] };
    await prisma.block.update({ where: { id: b.id }, data: { content: { ...content, components: comps } } });
    updated++;
  }
  console.log(`\n✅ XONG: cập nhật ${updated} câu chào · thiếu ${missing} · bỏ qua ${skipped}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('LỖI:', e); await prisma.$disconnect(); process.exit(1); });
