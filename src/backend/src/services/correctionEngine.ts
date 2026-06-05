/**
 * 修正引擎 - 核心创新点
 * 维护翻译历史，当新片段揭示前文错误时自动修正
 */

import { translateAudio } from './unifiedAIService.js';
import { AudioBufferManager } from '../utils/audioBuffer.js';
import type { Segment, CorrectionMessage } from '../types/index.js';

/** 编辑距离计算（Levenshtein Distance） */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** 计算两个字符串的差异比率（0~1） */
function diffRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  return editDistance(a, b) / maxLen;
}

/** 提取文本中的专有名词（简单启发式：大写开头的英文词） */
function extractProperNouns(text: string): string[] {
  const matches = text.match(/[A-Z][a-zA-Z]+/g);
  return matches ? [...new Set(matches)] : [];
}

export interface CorrectionCallbacks {
  onCorrection: (msg: CorrectionMessage) => void;
}

export class CorrectionEngine {
  private segments: Segment[] = [];
  private terminology: Map<string, string> = new Map(); // 术语一致性表
  private audioBuffer: AudioBufferManager;
  private apiKey: string;
  private callbacks: CorrectionCallbacks;
  private checkInterval = 3; // 每 N 个片段触发一次回溯检查
  private segmentCount = 0;

  constructor(
    audioBuffer: AudioBufferManager,
    apiKey: string,
    callbacks: CorrectionCallbacks
  ) {
    this.audioBuffer = audioBuffer;
    this.apiKey = apiKey;
    this.callbacks = callbacks;
  }

  /** 添加新的翻译片段 */
  addSegment(segment: Segment): void {
    this.segments.push(segment);
    this.segmentCount++;

    // 更新术语表
    const nouns = extractProperNouns(segment.translatedText);
    for (const noun of nouns) {
      if (!this.terminology.has(noun)) {
        this.terminology.set(noun, noun);
      }
    }

    // 每 N 个片段触发回溯修正检查
    if (this.segmentCount % this.checkInterval === 0) {
      this.backtrackCheck().catch(console.error);
    }
  }

  /** 获取所有片段 */
  getSegments(): Segment[] {
    return this.segments;
  }

  /** 回溯修正检查 */
  private async backtrackCheck(): Promise<void> {
    if (this.segments.length < 2) return;

    // 取最后 2 个已完成的片段进行回溯检查
    const len = this.segments.length;
    const targets = this.segments.slice(Math.max(0, len - 3), len - 1);

    for (const target of targets) {
      if (target.status === 'corrected') continue; // 已修正的跳过

      try {
        // 获取上下文音频（最近 3 个片段）
        const contextAudio = this.audioBuffer.getMergedAudio(3);
        if (!contextAudio) continue;

        // 获取之前的翻译作为上下文
        const prevTexts = this.segments
          .filter((s) => s.id !== target.id)
          .slice(-2)
          .map((s) => s.translatedText);

        // 重新翻译
        let newTranslation = '';
        for await (const chunk of translateAudio(
          contextAudio,
          this.apiKey,
          { context: prevTexts }
        )) {
          newTranslation += chunk;
        }

        if (!newTranslation) continue;

        // 条件 A：编辑距离 > 20%
        const ratio = diffRatio(target.translatedText, newTranslation);
        const needsCorrection = ratio > 0.2;

        // 条件 C：专有名词一致性检查
        const oldNouns = extractProperNouns(target.translatedText);
        const newNouns = extractProperNouns(newTranslation);
        let nounInconsistent = false;
        for (const noun of newNouns) {
          const existing = this.terminology.get(noun);
          if (existing && existing !== noun) {
            nounInconsistent = true;
            break;
          }
        }

        if (needsCorrection || nounInconsistent) {
          const oldText = target.translatedText;
          target.translatedText = newTranslation;
          target.status = 'corrected';

          // 更新术语表
          for (const noun of newNouns) {
            this.terminology.set(noun, noun);
          }

          const reason = needsCorrection
            ? '上下文修正（语义差异 > 20%）'
            : '专有名词一致性修正';

          this.callbacks.onCorrection({
            type: 'correction',
            segmentId: target.id,
            oldText,
            newText: newTranslation,
            reason,
          });
        }
      } catch (err) {
        console.error(`回溯修正失败 (segment ${target.id}):`, err);
      }
    }
  }

  /** 手动触发对指定片段的修正检查 */
  async checkSegment(segmentId: string): Promise<boolean> {
    const segment = this.segments.find((s) => s.id === segmentId);
    if (!segment) return false;

    try {
      const contextAudio = this.audioBuffer.getMergedAudio(3);
      if (!contextAudio) return false;

      let newTranslation = '';
      for await (const chunk of translateAudio(
        contextAudio,
        this.apiKey
      )) {
        newTranslation += chunk;
      }

      if (!newTranslation) return false;

      const ratio = diffRatio(segment.translatedText, newTranslation);
      if (ratio > 0.2) {
        const oldText = segment.translatedText;
        segment.translatedText = newTranslation;
        segment.status = 'corrected';

        this.callbacks.onCorrection({
          type: 'correction',
          segmentId,
          oldText,
          newText: newTranslation,
          reason: '手动修正',
        });
        return true;
      }
      return false;
    } catch (err) {
      console.error(`手动修正失败 (segment ${segmentId}):`, err);
      return false;
    }
  }
}
