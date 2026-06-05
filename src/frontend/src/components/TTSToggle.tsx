/**
 * 语音合成开关组件
 * 使用 Web Speech API 进行中文语音播报
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Subtitle } from '../hooks/useCorrection';

interface TTSToggleProps {
  enabled: boolean;
  onToggle: () => void;
  subtitles: Subtitle[];
}

export function TTSToggle({ enabled, onToggle, subtitles }: TTSToggleProps) {
  const lastSpokenRef = useRef<string>('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // 加载中文语音列表
  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      const zhVoices = available.filter(
        (v) => v.lang.startsWith('zh') || v.lang.startsWith('cmn')
      );
      setVoices(zhVoices);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // 当字幕更新且 TTS 开启时播报
  const speak = useCallback(
    (text: string) => {
      if (!enabled || !text || text === lastSpokenRef.current) return;
      lastSpokenRef.current = text;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // 优先使用中文语音
      if (voices.length > 0) {
        utterance.voice = voices[0];
      }

      window.speechSynthesis.cancel(); // 取消之前的播报
      window.speechSynthesis.speak(utterance);
    },
    [enabled, voices]
  );

  // 监听字幕变化播报
  useEffect(() => {
    if (!enabled || subtitles.length === 0) return;
    const latest = subtitles[subtitles.length - 1];
    if (latest.text === lastSpokenRef.current) return;
    // confirmed 或 refined 时播报
    if (latest.status === 'confirmed' || latest.status === 'refined') {
      speak(latest.text);
    }
  }, [subtitles, enabled, speak]);

  return (
    <button
      onClick={onToggle}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all
        ${
          enabled
            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
            : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-transparent'
        }
      `}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        {enabled ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M11 5L6 9H2v6h4l5 4V5z"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"
          />
        )}
      </svg>
      语音播报 {enabled ? '开' : '关'}
    </button>
  );
}
