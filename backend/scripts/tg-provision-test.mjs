/**
 * tg-provision-test.mjs — Thử tự cấp 1 supergroup qua tài khoản provisioner (GramJS).
 * Tạo megagroup + bật forum (topics) + thêm bot làm admin (manage topics). In ra chat id
 * (định dạng Bot API -100...). Chứng minh Phase 3.0 trước khi tích hợp vào app.
 *
 *   docker compose exec -e API_ID=.. -e API_HASH=.. -e SESSION=<..> -e TITLE="Nick 2 — Cầu" \
 *     app node /app/scripts/tg-provision-test.mjs
 */
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || '';
const session = process.env.SESSION || '';
const title = process.env.TITLE || 'Cầu Test';
const botUsername = process.env.BOT_USERNAME || 'hs_crm_bridge_bot';

const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 });
await client.connect();
if (!(await client.checkAuthorization())) {
  console.error('Session chưa authorized.');
  process.exit(1);
}

// 1. Tạo supergroup (megagroup)
const res = await client.invoke(
  new Api.channels.CreateChannel({ title, about: `Cầu Zalo↔Telegram — ${title}`, megagroup: true }),
);
const channel = res.chats[0];
const channelId = channel.id;
console.log('CHANNEL_ID=' + channelId);

// 2. Bật forum (topics)
try {
  await client.invoke(new Api.channels.ToggleForum({ channel, enabled: true }));
  console.log('FORUM=on');
} catch (e) {
  console.log('FORUM_ERR=' + String(e?.errorMessage || e));
}

// 3. Thêm bot + cấp admin (manage topics + gửi/xoá/ghim)
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
  console.log('BOT_ADMIN=ok');
} catch (e) {
  console.log('BOT_ERR=' + String(e?.errorMessage || e));
}

console.log('BOT_API_CHAT_ID=-100' + channelId);
await client.disconnect();
process.exit(0);
