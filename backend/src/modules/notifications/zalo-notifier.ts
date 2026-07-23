// SPDX-License-Identifier: AGPL-3.0-or-later
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';

const lastNotifiedMap = new Map<string, number>();

/**
 * Hàm phân tích và làm đẹp nội dung tin nhắn Zalo
 * Dịch JSON thô thành ngôn ngữ tự nhiên, lấy link ảnh, video, thông tin cuộc gọi
 */
function parseZaloMessage(rawContent: string): string {
  if (!rawContent) return "[Tin nhắn trống]";
  
  try {
    const parsed = JSON.parse(rawContent);

    // 1. Nhãn dán (Sticker)
    // Payload: {"id":29557,"catId":10882,"type":7}
    if (parsed.catId && parsed.id) {
      return "🌈 [Đã gửi một nhãn dán]";
    }

    // 2. Hệ thống (Cuộc gọi, Kết bạn)
    if (parsed.action) {
      // Đồng ý kết bạn
      // Payload action: "msginfo.actionlist"
      if (parsed.action === 'msginfo.actionlist' || (parsed.title && parsed.title.toLowerCase().includes('kết bạn'))) {
        return `🤝 [${parsed.title || 'Đã đồng ý kết bạn'}]`;
      }
      
      // Cuộc gọi nhỡ
      // Payload action: "recommened.misscall"
      if (parsed.action.includes('misscall')) {
        let callType = "Thoại";
        if (parsed.params) {
          try {
            const paramsObj = JSON.parse(parsed.params);
            if (paramsObj.calltype === 1) callType = "Video";
          } catch (e) {}
        }
        return `📞 [Cuộc gọi nhỡ - ${callType}]`;
      }

      // Cuộc gọi thành công/kết thúc
      if (parsed.action.includes('calltime')) {
        return "📞 [Cuộc gọi đã kết thúc]";
      }
    }

    // 3. Hình ảnh / Video / File
    // Tìm URL chất lượng cao nhất (ưu tiên hd trong params, rồi tới href)
    let mediaUrl = "";
    if (parsed.params) {
      try {
        const paramsObj = JSON.parse(parsed.params);
        if (paramsObj.hd) mediaUrl = paramsObj.hd;
      } catch(e) {}
    }
    if (!mediaUrl && parsed.href) mediaUrl = parsed.href;
    if (!mediaUrl && parsed.thumb) mediaUrl = parsed.thumb;

    if (mediaUrl) {
      // Chuẩn hóa link (Zalo thường escape url, ví dụ: https:\/\/...)
      mediaUrl = mediaUrl.replace(/\\\//g, '/');
      const lowerUrl = mediaUrl.toLowerCase();
      
      if (lowerUrl.match(/\.(mp4|mov|webm)/i)) {
        return `🎥 [Đã gửi một Video]\n🔗 Bấm để xem: ${mediaUrl}`;
      } else if (lowerUrl.match(/\.(pdf|doc|docx|xls|xlsx|txt)/i)) {
        return `📎 [Đã gửi một Tài liệu]\n🔗 Bấm để tải: ${mediaUrl}`;
      } else {
        // Mặc định coi là hình ảnh
        return `🖼️ [Đã gửi một Hình ảnh]\n🔗 Bấm để xem: ${mediaUrl}`;
      }
    }

    return "📎 [Đính kèm/Định dạng khác]";

  } catch (e) {
    // Nếu văng lỗi JSON parse -> Đây là tin nhắn TEXT bình thường (Hi, Alo, Ok...)
    // Cắt bớt nếu tin nhắn văn bản quá dài
    if (rawContent.length > 300) {
      return rawContent.substring(0, 300) + '... [Xem thêm trên CRM]';
    }
    return rawContent;
  }
}

export async function notifyStaffOnNewMessage(contactId: string, messageText: string, senderName: string) {
  logger.info(`[ZaloNotifier] Bắt đầu xử lý tin nhắn từ: ${senderName} (ContactID: ${contactId})`);
  
  try {
    const now = Date.now();
    const lastTime = lastNotifiedMap.get(contactId) || 0;
    
    // Tạm thời TẮT cooldown để test
    // if (now - lastTime < 15 * 60 * 1000) return;

    // 1. Lấy khách hàng và TOÀN BỘ nhân viên có quyền truy cập (ContactAccess)
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        contactAccess: true // Lấy danh sách những người được share
      }
    });
    
    if (!contact) return;

    // Gom tất cả ID nhân viên cần nhận thông báo (Chủ sở hữu + Người được share)
    const userIdsToNotify = new Set<string>();
    if (contact.assignedUserId) {
      userIdsToNotify.add(contact.assignedUserId);
    }
    if (contact.contactAccess && contact.contactAccess.length > 0) {
      contact.contactAccess.forEach(access => userIdsToNotify.add(access.userId));
    }

    if (userIdsToNotify.size === 0) {
      logger.warn(`[ZaloNotifier] Khách hàng ${senderName} CHƯA CÓ nhân viên phụ trách. Hủy gửi.`);
      return; 
    }

    // 2. Kiểm tra Nick hệ thống của tổ chức
    const org = await prisma.organization.findUnique({
      where: { id: contact.orgId },
      select: { systemNotifyZaloAccountId: true }
    });
    
    if (!org?.systemNotifyZaloAccountId) {
      logger.warn(`[ZaloNotifier] Tổ chức chưa cài đặt Nick Zalo Tổng đài. Hủy gửi.`);
      return;
    }

    // 3. Lấy thông tin TẤT CẢ nhân viên phụ trách (Bỏ qua cài đặt method, lấy luôn SĐT của User)
    const staffs = await prisma.user.findMany({
      where: { id: { in: Array.from(userIdsToNotify) } },
      select: { 
        id: true,
        phone: true,      // SĐT đăng nhập CRM của nhân viên
        fullName: true
      }
    });

    if (staffs.length === 0) {
      logger.warn(`[ZaloNotifier] Không tìm thấy dữ liệu của ${userIdsToNotify.size} nhân viên trong Database. Hủy gửi.`);
      return;
    }

    // 4. Lấy Client Zalo gửi tin
    const api = zaloPool.getApi(org.systemNotifyZaloAccountId);
    if (!api) {
      logger.warn(`[ZaloNotifier] Tài khoản Zalo Tổng đài (${org.systemNotifyZaloAccountId}) đang OFFLINE.`);
      return;
    }

    logger.info(`[ZaloNotifier] Bắt đầu gửi tin cho ${staffs.length} nhân viên.`);

    // --- RENDER TIN NHẮN HIỆN ĐẠI ---
    const cleanMessage = parseZaloMessage(messageText);
    const timeString = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const dateString = new Date().toLocaleDateString('vi-VN');
    
    const textToSend = 
`🔔 CÓ TIN NHẮN MỚI
━━━━━━━━━━━━━━━━━━
👤 Khách hàng: ${senderName}
⏰ Lúc: ${timeString} - ${dateString}

💬 Nội dung: 
${cleanMessage}

⚡ Hãy truy cập CRM để phản hồi ngay!`;

    // 5. Vòng lặp gửi thông báo cho từng nhân viên dựa vào SĐT
    for (const staff of staffs) {
      let targetUid: string | null = null;

      if (staff.phone) {
        try {
          // Quét SĐT của nhân viên để tìm UID Zalo
          const foundUser = await api.findUser(staff.phone);

          if (foundUser && foundUser.uid) {
            targetUid = foundUser.uid;
          } else {
            logger.warn(`[ZaloNotifier] [Nhân viên ${staff.fullName}] Không tìm ra tài khoản Zalo từ SĐT: ${staff.phone}`);
          }
        } catch (err) {
          logger.error(`[ZaloNotifier] [Nhân viên ${staff.fullName}] Lỗi api.findUser qua SĐT ${staff.phone}:`, err);
        }
      } else {
        logger.warn(`[ZaloNotifier] [Nhân viên ${staff.fullName}] Tài khoản CRM không có số điện thoại (phone = null).`);
      }

      // Nếu quét thành công ra UID thì gửi tin
      if (targetUid) {
        try {
          await api.sendMessage({ msg: textToSend }, targetUid, 0); // 0 = user (cá nhân), 1 = group
          logger.info(`[ZaloNotifier] ✅ Đã gửi Zalo thành công tới nhân viên ${staff.fullName} (UID: ${targetUid})`);
        } catch (sendErr) {
          logger.error(`[ZaloNotifier] ❌ Lỗi gửi tin cho nhân viên ${staff.fullName}:`, sendErr);
        }
      }
    }

    // 6. Đánh dấu đã thông báo cho khách hàng này để tính Cooldown
    lastNotifiedMap.set(contactId, now);

  } catch (error) {
    logger.error('[ZaloNotifier] Lỗi văng Exception:', error);
  }
}