/**
 * 音频滚动缓冲区管理
 * 维护最近 15 秒的音频片段，用于修正机制的上下文回溯
 */

export interface AudioSegment {
  id: string;
  data: string; // Base64 编码
  timestamp: number;
  duration: number; // 秒
}

export class AudioBufferManager {
  private segments: AudioSegment[] = [];
  private readonly maxDuration = 15; // 最大缓存 15 秒

  /** 添加新的音频片段 */
  append(segment: AudioSegment): void {
    this.segments.push(segment);
    this.trim();
  }

  /** 获取最近 N 个片段的音频上下文 */
  getContext(lastN: number = 3): AudioSegment[] {
    return this.segments.slice(-lastN);
  }

  /** 获取指定 ID 的片段 */
  getById(id: string): AudioSegment | undefined {
    return this.segments.find((s) => s.id === id);
  }

  /** 获取最近 N 个片段合并后的 Base64 音频（简单拼接） */
  getMergedAudio(lastN: number = 3): string {
    const ctx = this.getContext(lastN);
    if (ctx.length === 0) return '';
    // 返回最后一个片段的音频（简化处理，实际场景需要解码拼接）
    return ctx[ctx.length - 1].data;
  }

  /** 清空缓冲区 */
  clear(): void {
    this.segments = [];
  }

  /** 获取当前缓冲的总时长 */
  getTotalDuration(): number {
    return this.segments.reduce((sum, s) => sum + s.duration, 0);
  }

  /** 裁剪超出时长限制的旧片段 */
  private trim(): void {
    let total = this.getTotalDuration();
    while (total > this.maxDuration && this.segments.length > 1) {
      const removed = this.segments.shift();
      if (removed) total -= removed.duration;
    }
  }
}
