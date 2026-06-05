/**
 * SRT 字幕导出服务
 */

export interface SubtitleEntry {
  id: string;
  text: string;
  startTime: number; // 毫秒
  endTime: number;   // 毫秒
}

/** 毫秒转 SRT 时间格式 HH:MM:SS,mmm */
function formatSRTTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ml = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ml).padStart(3, '0')}`;
}

/** 将字幕数组格式化为 SRT 字符串 */
export function formatAsSRT(subtitles: SubtitleEntry[]): string {
  return subtitles
    .map((sub, i) => {
      const start = formatSRTTime(sub.startTime);
      const end = formatSRTTime(sub.endTime);
      return `${i + 1}\n${start} --> ${end}\n${sub.text}\n`;
    })
    .join('\n');
}

/** 触发 SRT 文件下载 */
export function downloadSRT(content: string, filename = 'subtitles.srt'): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
