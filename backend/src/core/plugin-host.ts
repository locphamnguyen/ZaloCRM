/**
 * Plugin host — nạp plugin core + (tùy chọn) plugin Enterprise.
 *
 * Thay cho việc app.ts import + app.register() từng route thủ công.
 * - Gom plugin core từ modules/plugins-index.ts.
 * - Thử import '@zalocrm/enterprise' (bản community KHÔNG có → bỏ qua sạch).
 * - Gate license: plugin có requiresLicense mà thiếu license → skip.
 *
 * NGUYÊN TẮC VÀNG: file này KHÔNG static-import EE; chỉ dynamic-import optional.
 */
import type { PluginContext, ZaloCrmPlugin } from '../plugin-api/index.js';
import { corePlugins } from '../modules/plugins-index.js';

export async function loadPlugins(ctx: PluginContext): Promise<void> {
  const plugins: ZaloCrmPlugin[] = [...corePlugins];

  // Optional enterprise bundle. Community edition không cài package này.
  try {
    // @ts-expect-error — '@zalocrm/enterprise' chỉ tồn tại ở bản enterprise.
    const ee = await import('@zalocrm/enterprise');
    if (Array.isArray(ee?.enterprisePlugins)) {
      plugins.push(...ee.enterprisePlugins);
      ctx.logger.info(`[plugin-host] enterprise bundle: +${ee.enterprisePlugins.length} plugin(s)`);
    }
  } catch {
    ctx.logger.info('[plugin-host] community edition — no enterprise plugins');
  }

  for (const p of plugins) {
    if (p.requiresLicense && !ctx.license.has(p.requiresLicense)) {
      ctx.logger.info(`[plugin-host] skip ${p.name} (license '${p.requiresLicense}' missing)`);
      continue;
    }
    await p.register(ctx);
    ctx.logger.info(`[plugin-host] loaded ${p.edition} plugin: ${p.name}@${p.version}`);
  }
}
