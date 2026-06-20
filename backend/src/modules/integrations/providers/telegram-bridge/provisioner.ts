/**
 * provisioner.ts — Tự cấp group Telegram cho 1 nick (Phase 3.0) qua tài khoản Telegram CÔNG TY
 * (GramJS/MTProto), vì Bot API không tạo group được. Tạo supergroup + bật forum (topics) +
 * thêm bot làm admin (manage topics) → lưu chat id vào TelegramBridgeConfig (bật cầu).
 *
 * Session tài khoản công ty lưu ở env TELEGRAM_PROVISIONER_SESSION (mã hoá MTProto, gitignored
 * trong .env). Đăng nhập 1 lần qua scripts/tg-provisioner-login.mjs.
 */
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';

const apiId = Number(process.env.TELEGRAM_PROVISIONER_API_ID);
const apiHash = process.env.TELEGRAM_PROVISIONER_API_HASH || '';
const session = process.env.TELEGRAM_PROVISIONER_SESSION || '';
const botUsername = process.env.TELEGRAM_BRIDGE_BOT_USERNAME || 'hs_crm_bridge_bot';

export function isProvisionerConfigured(): boolean {
  return Boolean(apiId && apiHash && session);
}

async function withClient<T>(fn: (client: TelegramClient) => Promise<T>): Promise<T> {
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/**
 * Tạo + cấu hình group Telegram cho nick → bật cầu. Trả chat id (Bot API -100...) hoặc null.
 * Nếu nick đã có telegramChatId thì KHÔNG tạo lại (chỉ bật enabled).
 */
export async function provisionNickGroup(zaloAccountId: string): Promise<{ chatId: string } | null> {
  if (!isProvisionerConfigured()) {
    logger.warn('[telegram-bridge] provisioner chưa cấu hình (thiếu TELEGRAM_PROVISIONER_*).');
    return null;
  }
  const nick = await prisma.zaloAccount.findUnique({
    where: { id: zaloAccountId },
    select: { id: true, orgId: true, displayName: true, telegramBridge: { select: { telegramChatId: true } } },
  });
  if (!nick) return null;

  // Đã có group → chỉ bật cầu, không tạo lại.
  if (nick.telegramBridge?.telegramChatId) {
    await prisma.telegramBridgeConfig.update({ where: { zaloAccountId }, data: { enabled: true } }).catch(() => {});
    return { chatId: nick.telegramBridge.telegramChatId };
  }

  const title = `📱 ${nick.displayName || 'Nick Zalo'} — Cầu`;
  return withClient(async (client) => {
    const res = (await client.invoke(
      new Api.channels.CreateChannel({ title, about: 'Cầu Zalo↔Telegram', megagroup: true }),
    )) as Api.Updates;
    const channel = (res.chats[0] as Api.Channel);
    const channelId = channel.id;

    try {
      await client.invoke(new Api.channels.ToggleForum({ channel, enabled: true }));
    } catch (e) {
      logger.warn(`[telegram-bridge] bật forum lỗi: ${String(e)}`);
    }

    try {
      const bot = await client.getEntity(botUsername);
      await client.invoke(new Api.channels.InviteToChannel({ channel, users: [bot] }));
      await client.invoke(
        new Api.channels.EditAdmin({
          channel,
          userId: bot,
          adminRights: new Api.ChatAdminRights({
            changeInfo: false,
            postMessages: false,
            editMessages: false,
            deleteMessages: true,
            banUsers: false,
            inviteUsers: true,
            pinMessages: true,
            addAdmins: false,
            anonymous: false,
            manageCall: false,
            other: false,
            manageTopics: true,
          }),
          rank: 'bridge',
        }),
      );
    } catch (e) {
      logger.warn(`[telegram-bridge] thêm bot admin lỗi: ${String(e)}`);
    }

    const chatId = `-100${channelId}`;
    await prisma.telegramBridgeConfig.upsert({
      where: { zaloAccountId },
      create: { orgId: nick.orgId, zaloAccountId, telegramChatId: chatId, enabled: true },
      update: { telegramChatId: chatId, enabled: true },
    });
    logger.info(`[telegram-bridge] đã cấp group ${chatId} cho nick ${zaloAccountId}`);
    return { chatId };
  });
}
