/**
 * 字幕显示组件（双语）
 * 状态颜色：live(绿) / refined(蓝) / confirmed(白)
 */

import { useEffect, useRef, useState } from 'react';
import type { Subtitle } from '../hooks/useCorrection';

interface SubtitleDisplayProps {
  subtitles: Subtitle[];
}

const statusColors: Record<string, string> = {
  live: 'text-emerald-400',
  refined: 'text-cyan-400',
  confirmed: 'text-white',
  hint: 'text-slate-500 italic',
};

const statusBadge: Record<string, { text: string; cls: string }> = {
  refined: { text: '已优化', cls: 'bg-cyan-500' },
};

export function SubtitleDisplay({ subtitles }: SubtitleDisplayProps) {
  const [animating, setAnimating] = useState(false);
  const lastStatusRef = useRef('');

  useEffect(() => {
    if (subtitles.length === 0) return;
    const current = subtitles[subtitles.length - 1];
    // hint 状态不触发动画
    if (current.status === 'hint') { setAnimating(false); return; }
    if (current.status === 'refined' && lastStatusRef.current !== 'refined') {
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 500);
      return () => clearTimeout(timer);
    }
    lastStatusRef.current = current.status;
  }, [subtitles]);

  if (subtitles.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-xl">
        等待音频输入...
      </div>
    );
  }

  // 过滤 hint 状态，只显示真实翻译
  const realSubtitles = subtitles.filter((s) => s.status !== 'hint');
  const hintSubtitle = subtitles.find((s) => s.status === 'hint');

  // 如果只有提示没有真实翻译，静态显示提示
  if (realSubtitles.length === 0 && hintSubtitle) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-xl text-slate-500 italic">{hintSubtitle.text}</p>
      </div>
    );
  }

  if (realSubtitles.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-xl">
        等待音频输入...
      </div>
    );
  }

  const current = realSubtitles[realSubtitles.length - 1];
  const previous = realSubtitles.length > 1 ? realSubtitles[realSubtitles.length - 2] : null;

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      {/* 上一句 */}
      {previous && (
        <div className={`w-full text-center transition-all duration-300 ${animating ? 'opacity-0 -translate-x-4' : 'opacity-60'}`}>
          <p className={`text-lg leading-relaxed ${statusColors[previous.status]}`}>
            {previous.text}
          </p>
          {previous.original && (
            <p className="text-sm text-slate-500 mt-1">{previous.original}</p>
          )}
        </div>
      )}

      {/* 当前句 */}
      <div className={`w-full text-center ${animating ? 'subtitle-correcting' : 'subtitle-enter'}`}>
        {/* 中文译文 */}
        <p className={`text-3xl font-bold leading-relaxed ${statusColors[current.status]}`}>
          {current.text}
          {current.status === 'live' && (
            <span className="inline-block w-0.5 h-7 bg-emerald-400 ml-1 animate-pulse" />
          )}
        </p>

        {/* 英文原文 */}
        {current.original && (
          <p className="text-lg text-slate-400 mt-2">{current.original}</p>
        )}

        {/* 状态徽章 */}
        {statusBadge[current.status] && (
          <span className={`inline-block text-[10px] ${statusBadge[current.status].cls} text-white px-2 py-0.5 rounded-full mt-2 animate-pulse`}>
            {statusBadge[current.status].text}
          </span>
        )}
      </div>
    </div>
  );
}
