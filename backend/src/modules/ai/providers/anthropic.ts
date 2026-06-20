// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
export async function generateWithAnthropic(baseUrl: string, apiKey: string, model: string, system: string, prompt: string, maxTokens = 600) {
  const url = `${baseUrl}/v1/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        authorization: `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic request failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((item) => item.type === 'text')?.text?.trim();
    if (!text) throw new Error('Anthropic returned empty content');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
