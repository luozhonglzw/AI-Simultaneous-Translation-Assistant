/**
 * 音频编码服务
 * 将 MediaRecorder 输出的 Blob 转为 Base64
 */

/** Blob 转 Base64 字符串 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // 去掉 data:audio/wav;base64, 前缀
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 校验 WAV 文件头（RIFF header） */
export function isValidWavHeader(base64: string): boolean {
  try {
    const raw = atob(base64.substring(0, 12));
    return raw.startsWith('RIFF') && raw.includes('WAVE');
  } catch {
    return false;
  }
}

/** 生成唯一 segment ID */
export function generateSegmentId(): string {
  return `seg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}
