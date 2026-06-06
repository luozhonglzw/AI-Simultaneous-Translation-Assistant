/**
 * Agent 1：音频监听 Agent（独立运行，零 API 调用）
 * 自主决策：分类音频 → 语音发给翻译 Agent，噪音直接通知前端
 */

import { BaseAgent, type AgentMessage } from './BaseAgent.js';

type AudioType = 'speech' | 'silence' | 'applause' | 'music' | 'noise';

export class AudioListenerAgent extends BaseAgent {
  private lastSpeechTime = new Map<string, number>(); // per clientId

  constructor() {
    super('audio-listener');
  }

  protected async decideAndAct(message: AgentMessage): Promise<void> {
    if (message.type !== 'new_audio') return;

    const { audioBase64, segmentId, sourceLanguage } = message.payload;
    const clientId = message.clientId!;

    // 自主决策：分析音频类型
    const result = this.classifyAudio(audioBase64);

    this.setState('last_analysis', result);
    this.setState('analysis_count', (this.getState<number>('analysis_count') || 0) + 1);

    if (result.type === 'speech') {
      this.lastSpeechTime.set(clientId, Date.now());
      // 有语音 → 通知翻译 Agent
      this.send('translator', 'speech_detected', {
        audioBase64,
        segmentId,
        sourceLanguage,
        confidence: result.confidence,
      }, clientId);

    } else if (result.type === 'applause' || result.type === 'music') {
      // 环境音 → 直接通知前端，跳过翻译
      const emoji = result.type === 'applause' ? '👏' : '🎵';
      this.sendToFrontend('hint', {
        translated: emoji,
        isEnvironmental: true,
      }, clientId);

    } else if (result.type === 'silence') {
      // 静音太久 → 通知组装 Agent 强制结束句子
      const lastSpeech = this.lastSpeechTime.get(clientId) || 0;
      if (Date.now() - lastSpeech > 2000) {
        this.send('assembler', 'force_end_sentence', { reason: 'long_silence' }, clientId);
      }
    }
  }

  protected async idleAction(): Promise<void> {
    // 空闲时清理过期的语音时间记录
    const now = Date.now();
    for (const [clientId, time] of this.lastSpeechTime) {
      if (now - time > 60000) this.lastSpeechTime.delete(clientId);
    }
  }

  /** 音频分类（基于 WAV 解码 + 时域特征） */
  private classifyAudio(audioBase64: string): { type: AudioType; confidence: number; duration: number } {
    const pcm = this.decodeWavToPCM(audioBase64);
    if (!pcm || pcm.length === 0) return { type: 'silence', confidence: 0.99, duration: 0 };

    const duration = pcm.length / 16000;

    // RMS
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i];
    const rms = Math.sqrt(sumSq / pcm.length);

    if (rms < 0.008) return { type: 'silence', confidence: 0.99, duration };

    // 零穿越率
    let crossings = 0;
    for (let i = 1; i < pcm.length; i++) {
      if ((pcm[i] > 0) !== (pcm[i - 1] > 0)) crossings++;
    }
    const zcr = crossings / pcm.length;

    // 短时能量方差
    const frameSize = 512;
    const energies: number[] = [];
    for (let i = 0; i < pcm.length; i += frameSize) {
      let e = 0;
      const end = Math.min(i + frameSize, pcm.length);
      for (let j = i; j < end; j++) e += pcm[j] * pcm[j];
      energies.push(e / (end - i));
    }
    const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
    const evar = mean > 0
      ? energies.reduce((s, e) => s + (e - mean) ** 2, 0) / energies.length / mean
      : 0;

    // 分类
    if (zcr > 0.25 && evar > 0.5) return { type: 'applause', confidence: 0.9, duration };
    if (zcr > 0.3) return { type: 'noise', confidence: 0.85, duration };
    if (zcr < 0.03 && rms > 0.08 && evar < 0.1) return { type: 'music', confidence: 0.85, duration };
    if (zcr >= 0.04 && zcr <= 0.25 && rms >= 0.015) return { type: 'speech', confidence: 0.95, duration };
    if (rms < 0.015) return { type: 'silence', confidence: 0.9, duration };

    return { type: 'noise', confidence: 0.8, duration };
  }

  private decodeWavToPCM(base64Audio: string): Float32Array | null {
    try {
      let b64 = base64Audio;
      if (b64.startsWith('data:')) b64 = b64.substring(b64.indexOf(',') + 1);
      const buf = Buffer.from(b64, 'base64');
      if (buf.length < 44) return null;

      const channels = buf.readUInt16LE(22);
      const bitsPerSample = buf.readUInt16LE(34);
      const dataSize = buf.readUInt32LE(40);
      const dataStart = 44;
      const bytesPerSample = bitsPerSample / 8;
      const totalFrames = Math.floor(Math.min(dataSize, buf.length - dataStart) / bytesPerSample / channels);

      const pcm = new Float32Array(totalFrames);
      for (let i = 0; i < totalFrames; i++) {
        const offset = dataStart + i * channels * bytesPerSample;
        if (bitsPerSample === 16) pcm[i] = buf.readInt16LE(offset) / 32768;
        else if (bitsPerSample === 32) pcm[i] = buf.readInt32LE(offset) / 2147483648;
        else pcm[i] = (buf.readUInt8(offset) - 128) / 128;
      }
      return pcm;
    } catch { return null; }
  }
}
