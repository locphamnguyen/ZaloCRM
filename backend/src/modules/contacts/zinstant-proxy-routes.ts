/**
 * zinstant-proxy-routes.ts — Parse Zalo zinstant bank card → trả structured data.
 *
 * Zalo HTML có VietQR EMVCo string embed (e.g. 00020101021138550010A000000727...).
 * Parse TLV (Tag-Length-Value) format để extract bank BIN + account number.
 * Frontend render UI riêng dùng img.vietqr.io cho QR thật.
 *
 * Security: whitelist hostname Zalo CDN. Public endpoint vì iframe khó pass auth.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../shared/utils/logger.js';

const ALLOWED_HOSTS = new Set([
  'zinst-stc.zadn.vn',
  'zinst-stc-pc.zadn.vn',
]);

// Vietnam bank BIN → metadata. Source: napas.com.vn + img.vietqr.io bank list.
const BANK_BIN_MAP: Record<string, { code: string; shortName: string; fullName: string; color: string }> = {
  '970423': { code: 'TPB', shortName: 'TPBank', fullName: 'Ngân hàng TPBank', color: '#6E1F95' },
  '970407': { code: 'TCB', shortName: 'Techcombank', fullName: 'Ngân hàng Techcombank', color: '#E60012' },
  '970436': { code: 'VCB', shortName: 'Vietcombank', fullName: 'Ngân hàng Vietcombank', color: '#1A8847' },
  '970422': { code: 'MB', shortName: 'MB Bank', fullName: 'Ngân hàng MB', color: '#172A6E' },
  '970418': { code: 'BIDV', shortName: 'BIDV', fullName: 'Ngân hàng BIDV', color: '#016648' },
  '970432': { code: 'VPB', shortName: 'VPBank', fullName: 'Ngân hàng VPBank', color: '#00A14B' },
  '970415': { code: 'ICB', shortName: 'VietinBank', fullName: 'Ngân hàng VietinBank', color: '#005EAB' },
  '970416': { code: 'ACB', shortName: 'ACB', fullName: 'Ngân hàng ACB', color: '#005AAA' },
  '970403': { code: 'STB', shortName: 'Sacombank', fullName: 'Ngân hàng Sacombank', color: '#00A862' },
  '970405': { code: 'AGRIBANK', shortName: 'Agribank', fullName: 'Ngân hàng Agribank', color: '#9E2031' },
  '970448': { code: 'OCB', shortName: 'OCB', fullName: 'Ngân hàng OCB', color: '#003F8C' },
  '970454': { code: 'VCCB', shortName: 'VietCapital', fullName: 'Ngân hàng Bản Việt', color: '#E1251B' },
  '970441': { code: 'VIB', shortName: 'VIB', fullName: 'Ngân hàng VIB', color: '#005BAA' },
  '970443': { code: 'SHB', shortName: 'SHB', fullName: 'Ngân hàng SHB', color: '#005DAA' },
  '970426': { code: 'MSB', shortName: 'MSB', fullName: 'Ngân hàng Hàng Hải', color: '#E20019' },
  '970437': { code: 'HDB', shortName: 'HDBank', fullName: 'Ngân hàng HDBank', color: '#ED1B2F' },
  '970438': { code: 'BAB', shortName: 'BacABank', fullName: 'Ngân hàng Bắc Á', color: '#003B71' },
};

interface BankCardData {
  bankBin: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  qrContent: string;
  color: string;
  logoUrl: string;
  qrImageUrl: string;
}

/**
 * Parse VietQR EMVCo string → bank BIN + account number.
 * Format: 38XX 0010A000000727 01XX 0006<6-digit BIN> 01XX <account-number> 0208...
 */
function parseVietQR(qrString: string): { bankBin: string; accountNumber: string } | null {
  // Tìm field 38 (Merchant Account Info), bên trong có subfield 01 (account)
  // Đơn giản: regex match bank BIN (luôn 6 số sau 0006) + account (sau 01XX)
  const binMatch = qrString.match(/0006(\d{6})/);
  if (!binMatch) return null;
  // Account number: ngay sau bin, format 01<length><account>
  const afterBin = qrString.substring(qrString.indexOf(binMatch[0]) + 10);
  const accMatch = afterBin.match(/^01(\d{2})(\d+)/);
  if (!accMatch) return null;
  const accLen = parseInt(accMatch[1]);
  return {
    bankBin: binMatch[1],
    accountNumber: accMatch[2].substring(0, accLen),
  };
}

export async function zinstantProxyRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/zalo-bankcard?url=<encoded zalo cdn url> → structured JSON
  // Public endpoint — chỉ parse public Zalo CDN content, không lộ data CRM
  app.get('/api/v1/zalo-bankcard', async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.query as { url?: string };
    if (!url) return reply.status(400).send({ error: 'url query required' });

    let parsed: URL;
    try { parsed = new URL(url); } catch { return reply.status(400).send({ error: 'invalid url' }); }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return reply.status(403).send({ error: 'host not allowed' });
    }

    try {
      const res = await fetch(parsed.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZaloCRM/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return reply.status(res.status).send({ error: 'upstream error' });
      const body = await res.text();

      // Extract VietQR EMVCo string từ HTML (trong action=transfer&content=...)
      // EMVCo strings bắt đầu bằng 00020101 (Payload Format + Static QR)
      const qrMatch = body.match(/content=(00020101[^&"']+)/);
      if (!qrMatch) {
        logger.info('[bankcard] No VietQR string in HTML — render fallback');
        return reply.send({ raw: true, message: 'Không phân tích được mã QR' });
      }

      const qrContent = decodeURIComponent(qrMatch[1]).replace(/&amp;/g, '&');
      const parsedQr = parseVietQR(qrContent);
      if (!parsedQr) {
        return reply.send({ raw: true, message: 'Không parse được VietQR EMVCo' });
      }

      const meta = BANK_BIN_MAP[parsedQr.bankBin];
      const data: BankCardData = {
        bankBin: parsedQr.bankBin,
        bankCode: meta?.code || 'UNKNOWN',
        bankName: meta?.fullName || `Ngân hàng (BIN ${parsedQr.bankBin})`,
        accountNumber: parsedQr.accountNumber,
        qrContent,
        color: meta?.color || '#1976d2',
        logoUrl: meta ? `https://api.vietqr.io/img/${meta.code}.png` : '',
        // img.vietqr.io tạo QR image động — không cần lưu, không cần key
        qrImageUrl: meta
          ? `https://img.vietqr.io/image/${meta.code}-${parsedQr.accountNumber}-compact.png`
          : '',
      };

      reply
        .header('Cache-Control', 'public, max-age=3600')
        .send(data);
    } catch (err) {
      logger.warn('[bankcard-proxy] fetch error:', err);
      return reply.status(502).send({ error: 'upstream fetch failed' });
    }
  });
}
