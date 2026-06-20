// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Shared handler for OpenAI-compatible chat/completions API.
 * Works with: OpenAI, Qwen (dashscope compat mode), Kimi (Moonshot).
 */
export async function generateWithOpenaiCompat(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
  maxTokens = 600,
  // OpenAI thế hệ mới (gpt-5.x / o-series) bỏ `max_tokens`, đòi `max_completion_tokens`.
  // Qwen/Kimi (compat mode cũ) vẫn dùng `max_tokens` → cho phép caller chọn tên tham số.
  tokenParam: 'max_tokens' | 'max_completion_tokens' = 'max_tokens',
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        [tokenParam]: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      throw new Error(`OpenAI-compat request failed with status ${status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI-compat returned empty content');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
