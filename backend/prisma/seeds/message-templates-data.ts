// 60 mẫu tin nhắn seed cho 4 dự án (15 mẫu/dự án) — Anh chốt 2026-06-09.
// FAQ (giá, pháp lý, tiến độ, vị trí, tiện ích, thanh toán, bàn giao) + câu hỏi khêu gợi nhu cầu.
//
// CÚ PHÁP ĐỊNH DẠNG (parser ở seed-message-templates.ts tự tính {text, styles[]}):
//   **...**         → đậm (st:'b')
//   [[c:đỏ]]...[[/]] → màu chữ. Tên màu Zalo hợp lệ: đỏ/cam/vàng/xanhla/xanhduong
//   Biến: {gender} {name} {sale} — điền lúc chèn vào chat (KHÔNG render ở seed).
// Mã màu Zalo hợp lệ (rich-text-editor COLOR_OPTIONS): db342e/f27806/f7b503/15a85f/2962ff.

export const PROJECT_TAGS = [
  'Emerald Garden View',
  'Emerald Boulevard',
  'Emerald River Park',
  'Monrei Sài Gòn',
] as const;

export interface SeedTemplate {
  name: string;
  category: string;    // FAQ | Chào | Khơi gợi | Chốt
  body: string;        // có marker đậm/màu/biến
  shortcut?: string;   // (tùy chọn) tự sinh từ prefix dự án + chức năng nếu không khai
}

// Prefix gõ tắt mỗi dự án + từ khóa chức năng theo tên mẫu → shortcut "/<prefix><fn>".
export const PROJECT_SHORTCUT_PREFIX: Record<(typeof PROJECT_TAGS)[number], string> = {
  'Emerald Garden View': 'egv',
  'Emerald Boulevard': 'eb',
  'Emerald River Park': 'erp',
  'Monrei Sài Gòn': 'mr',
};

// Map cụm tên mẫu → từ khóa chức năng ngắn (sau prefix dự án).
export function functionKeyFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('chào')) return 'chao';
  if (n.includes('hỏi giá') || n.includes('giá')) return 'gia';
  if (n.includes('pháp lý')) return 'phaply';
  if (n.includes('tiến độ')) return 'tiendo';
  if (n.includes('vị trí')) return 'vitri';
  if (n.includes('tiện ích') || n.includes('khai thác')) return 'tienich';
  if (n.includes('thanh toán')) return 'thanhtoan';
  if (n.includes('ưu đãi')) return 'uudai';
  if (n.includes('so sánh')) return 'sosanh';
  if (n.includes('lợi nhuận') || n.includes('cho thuê')) return 'loinhuan';
  if (n.includes('mời') || n.includes('xem nhà') || n.includes('khảo sát') || n.includes('tham quan')) return 'moixem';
  if (n.includes('theo dõi') || n.includes('sau tư vấn')) return 'theodoi';
  // Khơi gợi — phân biệt theo đuôi
  if (n.includes('ngân sách')) return 'ngansach';
  if (n.includes('thời điểm')) return 'thoidiem';
  if (n.includes('đầu tư')) return 'dautu';
  if (n.includes('mục đích') || n.includes('nhu cầu') || n.includes('ở/đầu tư') || n.includes('sống') || n.includes('đẳng cấp')) return 'nhucau';
  if (n.includes('gia đình')) return 'giadinh';
  if (n.includes('ngành')) return 'nganh';
  return 'mau';
}

// ─────────────────────────────────────────────────────────────────────────
// 1. EMERALD GARDEN VIEW (15)
// ─────────────────────────────────────────────────────────────────────────
const EMERALD_GARDEN_VIEW: SeedTemplate[] = [
  { name: 'EGV — Chào mở đầu', category: 'Chào',
    body: 'Dạ em chào {gender} {name} ạ. Em là {sale}, tư vấn dự án **[[c:xanhla]]Emerald Garden View[[/]]**. Em rất vui được hỗ trợ {gender} tìm hiểu căn hộ phù hợp ạ 🌿' },
  { name: 'EGV — Hỏi giá', category: 'FAQ',
    body: 'Dạ {gender} {name} ơi, giá căn hộ **Emerald Garden View** hiện từ [[c:đỏ]]**chỉ 2,1 tỷ/căn 2 phòng ngủ**[[/]] đã gồm VAT ạ. Tùy tầng và hướng sẽ có mức giá khác nhau. {gender} đang quan tâm loại mấy phòng ngủ để em báo bảng giá chi tiết ạ?' },
  { name: 'EGV — Pháp lý', category: 'FAQ',
    body: 'Dạ về pháp lý, **Emerald Garden View** đã có [[c:xanhla]]**sổ hồng từng căn**[[/]], chủ đầu tư uy tín, hợp đồng mua bán rõ ràng ạ. {gender} {name} hoàn toàn yên tâm về tính pháp lý nhé ạ.' },
  { name: 'EGV — Tiến độ', category: 'FAQ',
    body: 'Dạ dự án đang thi công đến **tầng 18**, dự kiến [[c:xanhduong]]**bàn giao quý 4/2026**[[/]] ạ. Tiến độ đúng cam kết, {gender} {name} có thể qua xem công trường thực tế bất cứ lúc nào ạ.' },
  { name: 'EGV — Vị trí', category: 'FAQ',
    body: 'Dạ **Emerald Garden View** tọa lạc ngay mặt tiền đường lớn, [[c:xanhduong]]**5 phút tới trung tâm**[[/]], gần trường học, bệnh viện, siêu thị ạ. Vị trí rất thuận tiện cho gia đình {gender} {name} sinh sống ạ.' },
  { name: 'EGV — Tiện ích', category: 'FAQ',
    body: 'Dạ dự án có **hồ bơi tràn bờ, gym, công viên nội khu, khu BBQ** và sân chơi trẻ em ạ. Mật độ xây dựng chỉ [[c:xanhla]]**38%**[[/]], không gian xanh thoáng đãng cho {gender} {name} ạ 🌳' },
  { name: 'EGV — Chính sách thanh toán', category: 'FAQ',
    body: 'Dạ {gender} {name} có thể thanh toán [[c:cam]]**giãn 18 tháng 0% lãi suất**[[/]], chỉ cần **thanh toán trước 20%** là nhận nhà ạ. Ngân hàng hỗ trợ vay tới 70% giá trị căn hộ nhé ạ.' },
  { name: 'EGV — Ưu đãi', category: 'Chốt',
    body: 'Dạ tháng này CĐT có [[c:đỏ]]**chiết khấu 5% + tặng gói nội thất 200 triệu**[[/]] cho 20 khách đầu tiên ạ. {gender} {name} chốt sớm sẽ được giữ căn đẹp và ưu đãi này ạ 🎁' },
  { name: 'EGV — Khơi gợi nhu cầu ở/đầu tư', category: 'Khơi gợi',
    body: 'Dạ cho em hỏi {gender} {name} mua để [[c:xanhduong]]**ở hay đầu tư**[[/]] ạ? Để em tư vấn căn phù hợp nhất — nếu ở thì em ưu tiên hướng mát, nếu đầu tư thì em chọn căn dễ cho thuê ạ.' },
  { name: 'EGV — Khơi gợi ngân sách', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} đang dự tính ngân sách khoảng bao nhiêu để em lọc đúng những căn trong tầm tài chính của {gender} ạ? Em có nhiều mức từ [[c:xanhla]]**2,1 tỷ đến 3,5 tỷ**[[/]] ạ.' },
  { name: 'EGV — Khơi gợi thời điểm', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} đang cần nhà ở ngay hay có thể chờ bàn giao ạ? Em hỏi để tư vấn giỏ hàng phù hợp — vì bên em có cả căn **bàn giao sớm** lẫn căn hình thành tương lai giá tốt hơn ạ.' },
  { name: 'EGV — So sánh đối thủ', category: 'FAQ',
    body: 'Dạ so với các dự án cùng khu, **Emerald Garden View** có lợi thế [[c:xanhla]]**giá mềm hơn 10-15% + mật độ xây thấp**[[/]] mà tiện ích lại đầy đủ ạ. Em gửi {gender} {name} bảng so sánh chi tiết nhé ạ?' },
  { name: 'EGV — Cho thuê/lợi nhuận', category: 'FAQ',
    body: 'Dạ căn 2 phòng ngủ ở đây cho thuê được [[c:cam]]**8-10 triệu/tháng**[[/]], lợi suất khoảng 5-6%/năm ạ. Khu vực đông dân cư, nhu cầu thuê cao nên {gender} {name} đầu tư rất an tâm dòng tiền ạ.' },
  { name: 'EGV — Mời xem nhà mẫu', category: 'Chốt',
    body: 'Dạ {gender} {name} sắp xếp cuối tuần này qua xem [[c:xanhduong]]**nhà mẫu thực tế**[[/]] với em được không ạ? Em đón {gender} tận nơi, đi xem trực tiếp sẽ dễ hình dung không gian sống hơn nhiều ạ.' },
  { name: 'EGV — Theo dõi sau tư vấn', category: 'Chốt',
    body: 'Dạ em gửi lại {gender} {name} thông tin **Emerald Garden View** ạ. {gender} xem qua rồi có thắc mắc gì cứ nhắn em nhé, em luôn sẵn sàng hỗ trợ {gender} 24/7 ạ. Cảm ơn {gender} đã quan tâm 🙏' },
];

// ─────────────────────────────────────────────────────────────────────────
// 2. EMERALD BOULEVARD (15)
// ─────────────────────────────────────────────────────────────────────────
const EMERALD_BOULEVARD: SeedTemplate[] = [
  { name: 'EB — Chào mở đầu', category: 'Chào',
    body: 'Dạ em chào {gender} {name} ạ. Em là {sale}, chuyên viên tư vấn **[[c:xanhduong]]Emerald Boulevard[[/]]** — khu shophouse thương mại sầm uất ạ. Em hỗ trợ {gender} ngay nhé 🏙️' },
  { name: 'EB — Hỏi giá', category: 'FAQ',
    body: 'Dạ {gender} {name} ơi, shophouse **Emerald Boulevard** giá từ [[c:đỏ]]**8,5 tỷ/căn**[[/]] đã gồm VAT, diện tích đa dạng 5x20 đến 6x22 ạ. {gender} quan tâm căn mặt tiền hay trong nội khu để em báo giá chuẩn ạ?' },
  { name: 'EB — Pháp lý', category: 'FAQ',
    body: 'Dạ **Emerald Boulevard** có [[c:xanhla]]**sổ hồng lâu dài, sở hữu vĩnh viễn**[[/]] ạ. Pháp lý hoàn chỉnh, công chứng sang tên ngay, {gender} {name} yên tâm tuyệt đối ạ.' },
  { name: 'EB — Tiến độ', category: 'FAQ',
    body: 'Dạ phân khu shophouse đã [[c:xanhla]]**hoàn thiện phần thô, bàn giao quý 2/2026**[[/]] ạ. {gender} {name} có thể nhận nhà kinh doanh được luôn sau bàn giao ạ.' },
  { name: 'EB — Vị trí', category: 'FAQ',
    body: 'Dạ **Emerald Boulevard** nằm trên [[c:xanhduong]]**trục đường thương mại chính**[[/]], dân cư đông, lưu lượng xe lớn — cực kỳ lý tưởng để kinh doanh cho {gender} {name} ạ.' },
  { name: 'EB — Tiện ích/Khai thác', category: 'FAQ',
    body: 'Dạ khu shophouse kết nối trực tiếp **khối căn hộ 2.000 dân**, đảm bảo nguồn khách tại chỗ ạ. {gender} {name} mở [[c:cam]]**cà phê, nhà hàng, cửa hàng tiện lợi**[[/]] đều rất hợp ạ.' },
  { name: 'EB — Chính sách thanh toán', category: 'FAQ',
    body: 'Dạ {gender} {name} thanh toán [[c:cam]]**theo tiến độ 12 đợt**[[/]], ngân hàng hỗ trợ vay 65% ạ. Chỉ cần vốn ban đầu khoảng 30% là {gender} đã sở hữu được căn shophouse rồi ạ.' },
  { name: 'EB — Ưu đãi', category: 'Chốt',
    body: 'Dạ đợt này CĐT [[c:đỏ]]**chiết khấu 8% thanh toán nhanh + tặng 2 năm phí quản lý**[[/]] ạ. Số lượng căn đẹp còn rất ít, {gender} {name} nên giữ chỗ sớm ạ 🎯' },
  { name: 'EB — Khơi gợi mục đích', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} mua shophouse để [[c:xanhduong]]**tự kinh doanh hay cho thuê lại**[[/]] ạ? Em hỏi để tư vấn vị trí căn phù hợp — mặt tiền hợp tự kinh doanh, còn cho thuê thì em có căn dòng tiền tốt ạ.' },
  { name: 'EB — Khơi gợi ngành hàng', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} dự định kinh doanh ngành gì để em chọn căn có vị trí và mặt bằng tối ưu cho ngành đó ạ? Mỗi ngành hàng sẽ hợp với một vị trí khác nhau trong khu ạ.' },
  { name: 'EB — Khơi gợi ngân sách đầu tư', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} đang dự kiến đầu tư khoảng bao nhiêu ạ? Em có giỏ hàng từ [[c:xanhla]]**8,5 tỷ đến 15 tỷ**[[/]] tùy diện tích và vị trí, để em lọc đúng tầm của {gender} ạ.' },
  { name: 'EB — Lợi nhuận cho thuê', category: 'FAQ',
    body: 'Dạ shophouse khu này cho thuê được [[c:cam]]**35-50 triệu/tháng**[[/]], lợi suất 5-7%/năm và tăng giá theo dân cư về ở ạ. {gender} {name} vừa có dòng tiền vừa giữ được tài sản ạ.' },
  { name: 'EB — So sánh đối thủ', category: 'FAQ',
    body: 'Dạ điểm hơn của **Emerald Boulevard** là [[c:xanhla]]**có sẵn 2.000 dân nội khu**[[/]] — nhiều shophouse nơi khác xây xong nhưng vắng dân, kinh doanh ế ạ. Ở đây {gender} {name} có khách ngay ạ.' },
  { name: 'EB — Mời khảo sát thực tế', category: 'Chốt',
    body: 'Dạ {gender} {name} qua khảo sát [[c:xanhduong]]**lưu lượng người qua lại thực tế**[[/]] cuối tuần với em nhé? Đứng tại căn mới thấy được tiềm năng kinh doanh, em đón {gender} tận nơi ạ.' },
  { name: 'EB — Theo dõi sau tư vấn', category: 'Chốt',
    body: 'Dạ em gửi lại {gender} {name} thông tin shophouse **Emerald Boulevard** ạ. {gender} cân nhắc rồi báo em, căn đẹp giá tốt thường hết nhanh nên em sẽ ưu tiên giữ cho {gender} ạ 🙏' },
];

// ─────────────────────────────────────────────────────────────────────────
// 3. EMERALD RIVER PARK (15)
// ─────────────────────────────────────────────────────────────────────────
const EMERALD_RIVER_PARK: SeedTemplate[] = [
  { name: 'ERP — Chào mở đầu', category: 'Chào',
    body: 'Dạ em chào {gender} {name} ạ. Em là {sale}, tư vấn dự án **[[c:xanhla]]Emerald River Park[[/]]** — căn hộ view sông trong lành ạ. Em rất vui được đồng hành cùng {gender} 🌊' },
  { name: 'ERP — Hỏi giá', category: 'FAQ',
    body: 'Dạ {gender} {name} ơi, **Emerald River Park** giá từ [[c:đỏ]]**chỉ 2,4 tỷ/căn 2 phòng ngủ view sông**[[/]] ạ. Căn view sông đẹp số lượng có hạn, {gender} quan tâm hướng nào để em tư vấn ạ?' },
  { name: 'ERP — Pháp lý', category: 'FAQ',
    body: 'Dạ dự án [[c:xanhla]]**đầy đủ pháp lý, đã đủ điều kiện ký hợp đồng mua bán**[[/]], CĐT bảo lãnh ngân hàng ạ. {gender} {name} hoàn toàn yên tâm xuống tiền ạ.' },
  { name: 'ERP — Tiến độ', category: 'FAQ',
    body: 'Dạ công trình đang lên đến **tầng 22**, [[c:xanhduong]]**dự kiến bàn giao quý 1/2027**[[/]] ạ. Tiến độ ổn định, {gender} {name} qua xem thực tế công trường với em nhé ạ.' },
  { name: 'ERP — Vị trí ven sông', category: 'FAQ',
    body: 'Dạ **Emerald River Park** nằm [[c:xanhduong]]**ngay ven sông, không khí trong lành**[[/]], lùi khỏi khói bụi nội đô mà vẫn kết nối trung tâm 15 phút ạ. Sống ở đây {gender} {name} như nghỉ dưỡng mỗi ngày ạ.' },
  { name: 'ERP — Tiện ích', category: 'FAQ',
    body: 'Dạ dự án có **công viên ven sông, đường dạo bộ, hồ bơi vô cực hướng sông, gym, spa** ạ. Mật độ xây dựng thấp [[c:xanhla]]**chỉ 35%**[[/]], rất nhiều cây xanh cho gia đình {gender} {name} ạ 🌴' },
  { name: 'ERP — Chính sách thanh toán', category: 'FAQ',
    body: 'Dạ {gender} {name} thanh toán [[c:cam]]**chỉ 15% ký hợp đồng, giãn 20 đợt nhẹ nhàng**[[/]] ạ. Ngân hàng cho vay 70%, ân hạn gốc lãi tới khi nhận nhà nên rất nhẹ gánh cho {gender} ạ.' },
  { name: 'ERP — Ưu đãi', category: 'Chốt',
    body: 'Dạ tháng này có [[c:đỏ]]**chiết khấu 4% + tặng 1 năm phí quản lý + voucher nội thất 100 triệu**[[/]] ạ. {gender} {name} đặt chỗ sớm còn được chọn căn view sông đẹp nhất ạ 🎁' },
  { name: 'ERP — Khơi gợi nhu cầu sống', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} có thích không gian sống [[c:xanhla]]**gần thiên nhiên, view sông thoáng**[[/]] không ạ? Nếu {gender} mệt mỏi với phố xá đông đúc thì căn ven sông bên em sẽ rất hợp gu ạ.' },
  { name: 'ERP — Khơi gợi gia đình', category: 'Khơi gợi',
    body: 'Dạ gia đình {gender} {name} có mấy thành viên ạ? Để em tư vấn căn 2 hay 3 phòng ngủ cho phù hợp — nhà có trẻ nhỏ thì em ưu tiên căn gần công viên và khu vui chơi ạ.' },
  { name: 'ERP — Khơi gợi đầu tư', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} đầu tư thì em gợi ý căn view sông — vì [[c:cam]]**view đẹp luôn tăng giá tốt và dễ cho thuê**[[/]] hơn căn thường ạ. {gender} đang tính giữ dài hạn hay lướt sóng để em tư vấn đúng ạ?' },
  { name: 'ERP — Lợi nhuận', category: 'FAQ',
    body: 'Dạ căn view sông cho thuê được [[c:cam]]**10-13 triệu/tháng**[[/]], lại tăng giá nhanh khi dự án bàn giao ạ. {gender} {name} đầu tư vừa có dòng tiền vừa lời vốn ạ.' },
  { name: 'ERP — So sánh đối thủ', category: 'FAQ',
    body: 'Dạ lợi thế riêng của **Emerald River Park** là [[c:xanhla]]**view sông tự nhiên hiếm có**[[/]] — yếu tố này không dự án nội đô nào có được, nên giá trị giữ rất bền cho {gender} {name} ạ.' },
  { name: 'ERP — Mời tham quan', category: 'Chốt',
    body: 'Dạ {gender} {name} qua trải nghiệm [[c:xanhduong]]**không gian ven sông và nhà mẫu**[[/]] cuối tuần với em nhé? Đứng tại căn ngắm sông mới cảm nhận hết được, em đón {gender} tận nơi ạ 🚗' },
  { name: 'ERP — Theo dõi sau tư vấn', category: 'Chốt',
    body: 'Dạ em gửi lại {gender} {name} thông tin **Emerald River Park** ạ. {gender} xem qua rồi nhắn em bất cứ lúc nào nhé, em luôn sẵn lòng hỗ trợ {gender} chọn được căn ưng ý nhất ạ 🙏' },
];

// ─────────────────────────────────────────────────────────────────────────
// 4. MONREI SÀI GÒN (15)
// ─────────────────────────────────────────────────────────────────────────
const MONREI_SAIGON: SeedTemplate[] = [
  { name: 'Monrei — Chào mở đầu', category: 'Chào',
    body: 'Dạ em chào {gender} {name} ạ. Em là {sale}, tư vấn căn hộ cao cấp **[[c:xanhduong]]Monrei Sài Gòn[[/]]** — chuẩn sống thượng lưu giữa trung tâm ạ. Em hân hạnh hỗ trợ {gender} ✨' },
  { name: 'Monrei — Hỏi giá', category: 'FAQ',
    body: 'Dạ {gender} {name} ơi, **Monrei Sài Gòn** giá từ [[c:đỏ]]**4,2 tỷ/căn 1 phòng ngủ**[[/]] tại vị trí trung tâm ạ. Đây là phân khúc cao cấp, {gender} quan tâm loại căn nào để em gửi bảng giá riêng ạ?' },
  { name: 'Monrei — Pháp lý', category: 'FAQ',
    body: 'Dạ **Monrei Sài Gòn** [[c:xanhla]]**pháp lý minh bạch, CĐT lớn uy tín, có bảo lãnh ngân hàng**[[/]] ạ. {gender} {name} đầu tư phân khúc cao cấp nên càng yên tâm về pháp lý ạ.' },
  { name: 'Monrei — Tiến độ', category: 'FAQ',
    body: 'Dạ dự án đang hoàn thiện, [[c:xanhduong]]**dự kiến bàn giao quý 3/2026**[[/]] với tiêu chuẩn nội thất nhập khẩu ạ. {gender} {name} đặt sớm còn được chọn căn tầng cao view đẹp ạ.' },
  { name: 'Monrei — Vị trí trung tâm', category: 'FAQ',
    body: 'Dạ **Monrei Sài Gòn** tọa lạc [[c:xanhduong]]**ngay lõi trung tâm, kết nối mọi tiện ích cao cấp**[[/]] — văn phòng, trung tâm thương mại, trường quốc tế đều trong bán kính ngắn ạ. Vị trí kim cương cho {gender} {name} ạ.' },
  { name: 'Monrei — Tiện ích cao cấp', category: 'FAQ',
    body: 'Dạ dự án có **hồ bơi vô cực tầng thượng, sky lounge, phòng gym 5 sao, lễ tân 24/7, hầm xe thông minh** ạ. Chuẩn dịch vụ [[c:cam]]**resort 5 sao**[[/]] phục vụ {gender} {name} mỗi ngày ạ 🥂' },
  { name: 'Monrei — Chính sách thanh toán', category: 'FAQ',
    body: 'Dạ {gender} {name} có thể chọn [[c:cam]]**thanh toán nhanh chiết khấu sâu hoặc giãn tiến độ 0% lãi**[[/]] ạ. Ngân hàng hỗ trợ vay tới 70%, nhiều phương án linh hoạt để em tư vấn theo dòng tiền của {gender} ạ.' },
  { name: 'Monrei — Ưu đãi', category: 'Chốt',
    body: 'Dạ giai đoạn này CĐT [[c:đỏ]]**chiết khấu lên tới 10% + tặng gói nội thất cao cấp 300 triệu**[[/]] cho khách thiện chí ạ. Quỹ căn đẹp giới hạn, {gender} {name} nên giữ chỗ sớm ạ 🎁' },
  { name: 'Monrei — Khơi gợi đẳng cấp sống', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} đang tìm một nơi ở [[c:xanhduong]]**xứng tầm, riêng tư và đẳng cấp**[[/]] đúng không ạ? **Monrei Sài Gòn** được thiết kế cho cộng đồng cư dân tinh hoa, em nghĩ sẽ rất hợp với {gender} ạ.' },
  { name: 'Monrei — Khơi gợi đầu tư', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} mua để ở hay đầu tư cho thuê chuyên gia nước ngoài ạ? Căn hộ trung tâm cao cấp thế này [[c:cam]]**dòng khách thuê expat rất ổn định**[[/]], em tư vấn căn tối ưu cho {gender} ạ.' },
  { name: 'Monrei — Khơi gợi ngân sách', category: 'Khơi gợi',
    body: 'Dạ {gender} {name} đang dự tính tầm ngân sách nào ạ? Em có giỏ hàng từ [[c:xanhla]]**4,2 tỷ tới hơn 10 tỷ**[[/]] tùy diện tích và tầng, để em chọn đúng căn xứng tầm {gender} ạ.' },
  { name: 'Monrei — Lợi nhuận cho thuê', category: 'FAQ',
    body: 'Dạ căn ở **Monrei Sài Gòn** cho thuê chuyên gia được [[c:cam]]**18-25 triệu/tháng**[[/]], khách thuê cao cấp ổn định ạ. {gender} {name} vừa giữ tài sản trung tâm vừa có dòng tiền tốt ạ.' },
  { name: 'Monrei — So sánh đối thủ', category: 'FAQ',
    body: 'Dạ điểm khác biệt của **Monrei Sài Gòn** là [[c:xanhla]]**vị trí lõi trung tâm + chuẩn bàn giao cao cấp**[[/]] mà giá còn cạnh tranh hơn các dự án cùng phân khúc ạ. Em gửi {gender} {name} bảng so sánh nhé ạ?' },
  { name: 'Monrei — Mời xem nhà mẫu', category: 'Chốt',
    body: 'Dạ {gender} {name} qua trải nghiệm [[c:xanhduong]]**nhà mẫu chuẩn bàn giao cao cấp**[[/]] với em nhé? Em sắp xếp đón {gender} chu đáo, trải nghiệm trực tiếp mới cảm nhận hết đẳng cấp dự án ạ ✨' },
  { name: 'Monrei — Theo dõi sau tư vấn', category: 'Chốt',
    body: 'Dạ em gửi lại {gender} {name} thông tin **Monrei Sài Gòn** ạ. {gender} cân nhắc rồi nhắn em nhé, em luôn sẵn sàng tư vấn để {gender} chọn được căn hộ xứng tầm nhất ạ 🙏' },
];

export const SEED_TEMPLATES: Record<(typeof PROJECT_TAGS)[number], SeedTemplate[]> = {
  'Emerald Garden View': EMERALD_GARDEN_VIEW,
  'Emerald Boulevard': EMERALD_BOULEVARD,
  'Emerald River Park': EMERALD_RIVER_PARK,
  'Monrei Sài Gòn': MONREI_SAIGON,
};
