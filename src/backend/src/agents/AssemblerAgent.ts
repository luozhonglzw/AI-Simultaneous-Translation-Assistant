/**
 * Agent 3：组装 Agent（独立运行，自主句子检测 + 超时管理）
 * 自主决策：检测完整句子 → 组装发送 / 超时强制发送
 */

import { BaseAgent, type AgentMessage } from './BaseAgent.js';

interface SegmentBuffer {
  segmentId: string;
  original: string;
  translated: string;
  timestamp: number;
}

export class AssemblerAgent extends BaseAgent {
  private buffers = new Map<string, SegmentBuffer[]>(); // per clientId
  private sentenceTimers = new Map<string, ReturnType<typeof setTimeout>>(); // per clientId
  private readonly SENTENCE_TIMEOUT = 3000;

  constructor() {
    super('assembler');
  }

  protected async decideAndAct(message: AgentMessage): Promise<void> {
    const clientId = message.clientId!;

    switch (message.type) {
      case 'translation_result': {
        const { segmentId, original, translated, source } = message.payload;

        // 自主决策：错误/重试标记，直接转发
        if (message.payload.isRetrying) {
          this.sendToFrontend('hint', {
            translated: message.payload.translated,
            isTemporary: true,
          }, clientId);
          return;
        }

        const buffer = this.getBuffer(clientId);

        // 自主决策：检查是否是已有片段的修正
        const existingIdx = buffer.findIndex((s) => s.segmentId === segmentId);
        if (existingIdx >= 0) {
          buffer[existingIdx] = { segmentId, original, translated, timestamp: Date.now() };
          this.sendToFrontend('correction', {
            segmentId,
            newText: translated,
            source,
          }, clientId);
          return;
        }

        // 新片段加入缓冲
        buffer.push({ segmentId, original, translated, timestamp: Date.now() });

        // 自主决策：检查是否形成完整句子
        const trimmed = translated.trim();
        const isSentenceEnd = /[。！？.?!]$/.test(trimmed) || trimmed.length > 30;

        if (isSentenceEnd) {
          this.flushBuffer(clientId, false);
        } else {
          // 设置超时：3 秒无新内容则强制发送
          this.resetSentenceTimer(clientId);
        }
        break;
      }

      case 'force_end_sentence': {
        // 静音过久 → 强制结束
        this.flushBuffer(clientId, true);
        break;
      }
    }
  }

  protected async idleAction(): Promise<void> {
    // 自主行为：检查所有缓冲是否超时
    const now = Date.now();
    for (const [clientId, buffer] of this.buffers) {
      if (buffer.length > 0) {
        const last = buffer[buffer.length - 1];
        if (now - last.timestamp > 5000) {
          this.flushBuffer(clientId, true);
        }
      }
    }
  }

  private getBuffer(clientId: string): SegmentBuffer[] {
    if (!this.buffers.has(clientId)) this.buffers.set(clientId, []);
    return this.buffers.get(clientId)!;
  }

  private resetSentenceTimer(clientId: string): void {
    const existing = this.sentenceTimers.get(clientId);
    if (existing) clearTimeout(existing);
    this.sentenceTimers.set(clientId, setTimeout(() => {
      this.flushBuffer(clientId, true);
      this.sentenceTimers.delete(clientId);
    }, this.SENTENCE_TIMEOUT));
  }

  private flushBuffer(clientId: string, forced: boolean): void {
    const buffer = this.buffers.get(clientId);
    if (!buffer || buffer.length === 0) return;

    const fullOriginal = buffer.map((s) => s.original).join(' ');
    const fullTranslated = buffer.map((s) => s.translated).join('');

    // 发送完整句子到前端
    this.sendToFrontend('translation', {
      segmentId: buffer[0].segmentId,
      text: fullTranslated,
      original: fullOriginal,
      isFinal: true,
      isForced: forced,
    }, clientId);

    // 保留最后 1 个作为上下文
    const last = buffer[buffer.length - 1];
    this.buffers.set(clientId, [last]);

    // 清除定时器
    const timer = this.sentenceTimers.get(clientId);
    if (timer) { clearTimeout(timer); this.sentenceTimers.delete(clientId); }

    console.log(`[${this.agentId}] ${forced ? '强制' : '完整'}句子: ${fullTranslated.substring(0, 40)}`);
  }

  /** 外部获取上下文（供翻译 Agent 使用） */
  getContext(clientId: string): string[] {
    const buffer = this.buffers.get(clientId);
    if (!buffer) return [];
    return buffer.map((s) => s.translated);
  }

  /** 清理客户端数据 */
  cleanup(clientId: string): void {
    this.buffers.delete(clientId);
    const timer = this.sentenceTimers.get(clientId);
    if (timer) { clearTimeout(timer); this.sentenceTimers.delete(clientId); }
  }
}
