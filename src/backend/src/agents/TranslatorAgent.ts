/**
 * Agent 2：翻译 Agent（独立运行，自主限流 + 缓存）
 * 自主决策：检查缓存 → 限流控制 → 调用 API → 429 自动重试
 */

import { BaseAgent, type AgentMessage } from './BaseAgent.js';
import { translateAudio, transcribeAudio, translateAudioNonStream } from '../services/unifiedAIService.js';

interface CacheEntry {
  translated: string;
  original: string;
  timestamp: number;
}

export class TranslatorAgent extends BaseAgent {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000;
  private readonly MAX_CACHE = 200;
  private readonly RATE_LIMIT = 10; // 每秒最多 10 次
  private apiCallTimes: number[] = [];
  private contextWindows = new Map<string, string[]>(); // per clientId

  constructor(private apiKey: string) {
    super('translator');
  }

  protected async decideAndAct(message: AgentMessage): Promise<void> {
    const clientId = message.clientId!;

    switch (message.type) {
      case 'speech_detected': {
        const { audioBase64, segmentId, sourceLanguage } = message.payload;

        // 自主决策：检查缓存
        const fp = this.fingerprint(audioBase64);
        const cached = this.cache.get(fp);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
          console.log(`[${this.agentId}] 缓存命中`);
          this.send('assembler', 'translation_result', {
            segmentId,
            original: cached.original,
            translated: cached.translated,
            source: 'cache',
          }, clientId);
          return;
        }

        // 自主决策：限流检查
        if (!this.checkRateLimit()) {
          // 限流中 → 延迟重试
          setTimeout(() => this.receiveMessage(message), 200);
          return;
        }

        // 调用 API（流式）
        try {
          const context = this.getContext(clientId);
          let fullText = '';
          let originalText = '';

          const stream = translateAudio(audioBase64, this.apiKey, {
            sourceLanguage,
            context: context.slice(-2),
            mode: 'fast',
          });

          for await (const chunk of stream) {
            fullText += chunk;
            // 流式片段发给前端
            this.sendToFrontend('translation', {
              segmentId,
              text: chunk,
              original: '',
              isFinal: false,
              status: 'live',
            }, clientId);
          }

          // 转录原文
          originalText = await transcribeAudio(audioBase64, this.apiKey);

          // 存入缓存
          this.cache.set(fp, { translated: fullText, original: originalText, timestamp: Date.now() });

          // 更新上下文
          this.pushContext(clientId, fullText);

          // 发送最终结果给组装 Agent
          this.send('assembler', 'translation_result', {
            segmentId,
            original: originalText,
            translated: fullText,
            source: 'api',
          }, clientId);

        } catch (err: any) {
          console.error(`[${this.agentId}] 翻译失败:`, err.message);

          if (err.message?.includes('429') || err.message?.includes('limit')) {
            // 自主决策：429 错误 → 延迟重试
            this.sendToFrontend('hint', {
              translated: '(服务繁忙，稍后重试...)',
              isTemporary: true,
            }, clientId);
            setTimeout(() => this.receiveMessage(message), 5000);
          } else {
            this.sendToFrontend('error', {
              message: `翻译失败: ${err.message}`,
            }, clientId);
          }
        }
        break;
      }

      case 'correction_request': {
        // 后台精修请求
        const { audioBase64, segmentId, originalText } = message.payload;
        try {
          const context = this.getContext(clientId);
          const corrected = await translateAudioNonStream(audioBase64, this.apiKey, {
            context: context.slice(-2),
            mode: 'accurate',
          });

          if (corrected && corrected !== originalText) {
            this.sendToFrontend('correction', {
              segmentId,
              oldText: originalText,
              newText: corrected,
              reason: '后台精修',
            }, clientId);
          }
        } catch (err: any) {
          console.error(`[${this.agentId}] 精修失败:`, err.message);
        }
        break;
      }
    }
  }

  protected async idleAction(): Promise<void> {
    // 自主清理过期缓存
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.CACHE_TTL) this.cache.delete(key);
    }
    // 限制缓存大小
    if (this.cache.size > this.MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    this.apiCallTimes = this.apiCallTimes.filter((t) => now - t < 1000);
    if (this.apiCallTimes.length >= this.RATE_LIMIT) return false;
    this.apiCallTimes.push(now);
    return true;
  }

  private fingerprint(base64: string): string {
    return `${base64.substring(0, 200)}_${base64.length}`;
  }

  private getContext(clientId: string): string[] {
    return this.contextWindows.get(clientId) || [];
  }

  private pushContext(clientId: string, text: string): void {
    const ctx = this.getContext(clientId);
    ctx.push(text);
    if (ctx.length > 5) ctx.shift();
    this.contextWindows.set(clientId, ctx);
  }
}
