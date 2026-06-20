/**
 * tg-provisioner-login.mjs — Đăng nhập 1 lần tài khoản Telegram provisioner (GramJS/MTProto)
 * để lấy SESSION string (lưu vào .env TELEGRAM_PROVISIONER_SESSION). Tài khoản này dùng để
 * TỰ TẠO supergroup cho từng nick (bot không tạo group được). Phase 3.
 *
 * Chạy trong container app (có node_modules/telegram):
 *   Bước 1 (gửi OTP):
 *     docker compose exec -e API_ID=.. -e API_HASH=.. -e PHONE=+84.. app \
 *       node /app/scripts/tg-provisioner-login.mjs
 *     → in ra SESSION=... và PHONE_CODE_HASH=... + gửi OTP vào app Telegram của số đó.
 *   Bước 2 (nhập OTP):
 *     docker compose exec -e API_ID=.. -e API_HASH=.. -e PHONE=+84.. \
 *       -e SESSION=<từ bước 1> -e PHONE_CODE_HASH=<từ bước 1> -e CODE=<otp> \
 *       [-e PASSWORD=<mật khẩu 2FA nếu có>] app \
 *       node /app/scripts/tg-provisioner-login.mjs
 *     → in ra FINAL_SESSION=... → lưu vào .env: TELEGRAM_PROVISIONER_SESSION=<FINAL_SESSION>
 */
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || '';
const phone = process.env.PHONE || '';
const session = process.env.SESSION || '';
const code = process.env.CODE || '';
const password = process.env.PASSWORD || '';
const phoneCodeHash = process.env.PHONE_CODE_HASH || '';

if (!apiId || !apiHash || !phone) {
  console.error('Thiếu API_ID / API_HASH / PHONE. Xem hướng dẫn đầu file.');
  process.exit(1);
}

const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 });
await client.connect();

if (!code) {
  // ── Bước 1: gửi OTP ──
  const res = await client.sendCode({ apiId, apiHash }, phone);
  console.log('SESSION=' + client.session.save());
  console.log('PHONE_CODE_HASH=' + res.phoneCodeHash);
  console.log('>> OTP đã gửi vào app Telegram của số ' + phone + '. Chạy lại bước 2 với CODE=<otp>.');
} else {
  // ── Bước 2: nhập OTP → đăng nhập ──
  try {
    await client.invoke(
      new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }),
    );
  } catch (e) {
    if (String(e?.errorMessage) === 'SESSION_PASSWORD_NEEDED') {
      if (!password) {
        console.error('Tài khoản bật mật khẩu 2FA — chạy lại kèm PASSWORD=<mật khẩu>.');
        process.exit(1);
      }
      await client.signInWithPassword(
        { apiId, apiHash },
        { password: async () => password, onError: (err) => console.error(String(err)) },
      );
    } else {
      throw e;
    }
  }
  console.log('FINAL_SESSION=' + client.session.save());
  console.log('>> Đăng nhập XONG. Lưu vào .env: TELEGRAM_PROVISIONER_SESSION=<FINAL_SESSION>');
}

await client.disconnect();
process.exit(0);
