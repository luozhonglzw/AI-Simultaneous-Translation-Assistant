/**
 * 音频快速分类器（基于时域特征，无需 FFT）
 * 用于过滤环境音/掌声/笑声/音乐，只发送语音片段
 */

export type AudioType = 'speech' | 'silence' | 'noise' | 'music';

/** 计算 RMS 音量 */
function rms(pcm: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

/** 计算零穿越率（语音 ~0.05-0.2，噪音 >0.3，音乐 <0.02） */
function zeroCrossingRate(pcm: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < pcm.length; i++) {
    if ((pcm[i] > 0) !== (pcm[i - 1] > 0)) crossings++;
  }
  return crossings / pcm.length;
}

/** 计算短时能量变化率（语音起伏大，噪音/音乐较平稳） */
function energyVariance(pcm: Float32Array, frameSize: number = 512): number {
  const energies: number[] = [];
  for (let i = 0; i < pcm.length; i += frameSize) {
    let e = 0;
    const end = Math.min(i + frameSize, pcm.length);
    for (let j = i; j < end; j++) e += pcm[j] * pcm[j];
    energies.push(e / (end - i));
  }
  if (energies.length < 2) return 0;
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
  if (mean === 0) return 0;
  const variance = energies.reduce((s, e) => s + (e - mean) ** 2, 0) / energies.length;
  return variance / mean; // 归一化方差
}

/**
 * 快速音频分类
 * 基于 RMS、零穿越率、能量变化率判断音频类型
 */
export function classifyAudio(pcm: Float32Array): AudioType {
  const volume = rms(pcm);
  if (volume < 0.008) return 'silence';

  const zcr = zeroCrossingRate(pcm);
  const evar = energyVariance(pcm);

  // 掌声/笑声：高零穿越率 + 高能量波动
  if (zcr > 0.25 && evar > 0.5) return 'noise';

  // 音乐：低零穿越率 + 较高音量 + 低能量波动（旋律平稳）
  if (zcr < 0.03 && volume > 0.08 && evar < 0.1) return 'music';

  // 语音：中等零穿越率 + 中等音量
  if (zcr >= 0.04 && zcr <= 0.25 && volume >= 0.015) return 'speech';

  // 其他低音量杂音
  if (volume < 0.015) return 'silence';

  return 'noise';
}
