// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
export async function generateWithGemini(baseUrl: string, apiKey: string, model: string, system: string, prompt: string, maxTokens = 600) {
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    // 2026-05-21: gemini-2.5-flash mặc định bật "thinking" mode — model spend tokens lên thinking
    // TRƯỚC khi generate response thật → maxOutputTokens cap bị thinking ăn hết → response cut.
    // Fix: thinkingConfig.thinkingBudget = 0 để TẮT thinking, dồn full token quota cho output.
    // Tham khảo: https://ai.google.dev/gemini-api/docs/thinking
    const isGemini25 = /^gemini-2\.5/i.test(model);
    const generationConfig: Record<string, unknown> = {
      temperature: 0.4,
      maxOutputTokens: maxTokens,
    };
    if (isGemini25) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      const errBody = await response.text().catch(() => '');
      throw new Error(`Gemini request failed (${status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
    };
    const finishReason = data.candidates?.[0]?.finishReason || '';
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!text) {
      // Log usage để debug max_tokens issue.
      const usage = data.usageMetadata;
      throw new Error(`Gemini returned empty content (finishReason=${finishReason}, usage=${JSON.stringify(usage)})`);
    }
    if (finishReason === 'MAX_TOKENS') {
      // Output bị cắt → throw để caller biết là token issue, không phải logic
      throw new Error(`Gemini hit MAX_TOKENS — increase maxTokens (current=${maxTokens}, output len=${text.length})`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
