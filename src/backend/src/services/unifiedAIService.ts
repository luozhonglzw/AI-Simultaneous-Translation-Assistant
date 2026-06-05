/**
 * 阿里云百炼 Qwen-Omni 统一 AI 服务
 * - 翻译管道（快速，立即返回）
 * - 转录管道（识别原文）
 * - 修正管道（后台，用更多上下文重新翻译）
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';

const TRANSLATE_PROMPT_FAST = `你是同声传译专家。将音频内容翻译为中文。
要求：只输出中文翻译，不要原文，不要解释。口语化，技术术语保留英文。`;

const TRANSLATE_PROMPT_ACCURATE = `你是国际顶级会议的同声传译专家。将音频内容翻译为中文。
要求：
- 只输出翻译后的中文，不要输出原文，不要添加解释
- 保持技术术语准确（如 AI, API, Cloud 等保留英文或翻译为公认中文术语）
- 口语化表达，符合中文说话习惯
- 如果内容不完整，根据上下文合理补全语义
- 数字、人名、公司名必须准确翻译或保留原文
- 如果音频包含多个句子，请分别翻译，用换行分隔`;

const TRANSCRIBE_PROMPT = `请将音频中的语音内容转录为文字。只输出听到的原文，不要翻译，不要添加任何解释。`;

export interface TranslateOptions {
  sourceLanguage?: string;
  context?: string[];
  mode?: 'fast' | 'accurate';
}

function buildAudioDataUrl(base64Audio: string): string {
  return base64Audio.startsWith('data:') ? base64Audio : `data:audio/wav;base64,${base64Audio}`;
}

function getSystemPrompt(options: TranslateOptions): string {
  let prompt = options.mode === 'accurate' ? TRANSLATE_PROMPT_ACCURATE : TRANSLATE_PROMPT_FAST;
  if (options.sourceLanguage && options.sourceLanguage !== 'en') {
    const langMap: Record<string, string> = { ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语' };
    const langName = langMap[options.sourceLanguage] || options.sourceLanguage;
    prompt = prompt.replace('音频内容', `${langName}音频内容`);
  }
  return prompt;
}

/** 按标点拆分多句 */
export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[。！？.?!])\s*/);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 音频转录（识别原文） */
export async function transcribeAudio(base64Audio: string, apiKey: string): Promise<string> {
  try {
    return await callApi(base64Audio, apiKey, TRANSCRIBE_PROMPT);
  } catch (err) {
    console.error('[AI] 转录失败:', err);
    return '';
  }
}

/** 非流式 API 调用 */
async function callApi(base64Audio: string, apiKey: string, systemPrompt: string, context?: string[]): Promise<string> {
  const baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const modelId = process.env.MODEL_ID || 'qwen-omni-turbo';

  const messages: any[] = [{ role: 'system', content: systemPrompt }];
  if (context && context.length > 0) {
    for (const ctx of context) messages.push({ role: 'assistant', content: ctx });
  }
  messages.push({
    role: 'user',
    content: [{ type: 'input_audio', input_audio: { data: buildAudioDataUrl(base64Audio), format: 'wav' } }],
  });

  const body = { model: modelId, messages, stream: false, temperature: 0.1, max_tokens: 256 };

  // 调试保存
  const debugDir = 'temp';
  if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });
  try { writeFileSync(`${debugDir}/debug-api-${Date.now()}.json`, JSON.stringify(body, null, 2)); } catch {}

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[AI] API 错误:', errText);
    throw new Error(`API 失败 (${response.status}): ${errText}`);
  }

  const result: any = await response.json();
  return result.choices?.[0]?.message?.content || '';
}

/** 流式翻译（用于实时翻译管道） */
export async function* translateAudio(
  base64Audio: string,
  apiKey: string,
  options: TranslateOptions = {}
): AsyncGenerator<string, void, unknown> {
  const baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const modelId = process.env.MODEL_ID || 'qwen-omni-turbo';

  const messages: any[] = [{ role: 'system', content: getSystemPrompt(options) }];
  if (options.context && options.context.length > 0) {
    for (const ctx of options.context) messages.push({ role: 'assistant', content: ctx });
  }

  const audioDataUrl = buildAudioDataUrl(base64Audio);
  console.log('[AI] 音频大小:', base64Audio.length, '字符, 前缀:', base64Audio.substring(0, 60));

  messages.push({
    role: 'user',
    content: [{ type: 'input_audio', input_audio: { data: audioDataUrl, format: 'wav' } }],
  });

  const requestBody = { model: modelId, messages, stream: true, temperature: 0.1, max_tokens: 256 };

  const debugDir = 'temp';
  if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });
  try { writeFileSync(`${debugDir}/debug-api-${Date.now()}.json`, JSON.stringify(requestBody, null, 2)); } catch {}
  console.log('[AI] Request 大小:', JSON.stringify(requestBody).length);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[AI] API 错误:', errText);
    throw new Error(`API 失败 (${response.status}): ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {}
    }
  }
}

/** 非流式翻译（用于修正管道） */
export async function translateAudioNonStream(
  base64Audio: string,
  apiKey: string,
  options: TranslateOptions = {}
): Promise<string> {
  return callApi(base64Audio, apiKey, getSystemPrompt({ ...options, mode: 'accurate' }), options.context);
}
