/**
 * 历史管理 Hook（会话生命周期）
 * - 新开录音 / 切换语言 → 自动新建 Session
 * - 停止录音 → 结束当前 Session
 * - liveCache 去重，只存 confirmed
 * - 支持删除单个 Session
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubtitleEntry } from '../services/subtitleExporter';

export type SubtitleStatus = 'live' | 'refined' | 'confirmed' | 'hint';

// ─── 系统提示检测（不入历史） ───
const SYSTEM_HINTS = [
  '有什么可以帮助你的吗',
  '有什么可以帮助您的吗',
  '请问有什么可以帮助',
  '你好！有什么可以',
  '好的，请问有什么',
  '说吧，我在听',
  '我在听，请说',
  '请继续',
  '有什么可以帮您',
  '有什么可以帮你的',
  '你好！我是',
  '您好！有什么',
];

function isSystemHint(text: string): boolean {
  if (!text) return false;
  return SYSTEM_HINTS.some((hint) => text.includes(hint));
}

/** 纯标点/无意义文本（不显示也不入历史） */
function isMeaningless(text: string): boolean {
  if (!text) return true;
  return /^[？?！!。，,\s\d.]+$/u.test(text.trim());
}

export interface HistoryItem {
  id: string;
  sessionId: string;
  timestamp: number;
  original: string;
  translated: string;
  status: SubtitleStatus;
}

export interface Session {
  id: string;
  startTime: number;
  endTime?: number;
  language: string;
  items: HistoryItem[];
  isActive: boolean;
  isExpanded: boolean;
}

export interface Subtitle {
  id: string;
  text: string;
  original: string;
  status: SubtitleStatus;
  timestamp: number;
  startTime: number;
  sessionId: string;
}

const STORAGE_KEY = 'si-sessions-v2';

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw).map((s: Session) => ({ ...s, isExpanded: false, isActive: false }));
  } catch {}
  return [];
}

function saveSessions(sessions: Session[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.map(({ isExpanded, ...rest }) => rest)));
  } catch {}
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/** 自动生成会话标题 */
function generateSessionTitle(session: Session): string {
  const validItems = session.items.filter(
    (item) => !isSystemHint(item.translated) && !isMeaningless(item.translated)
  );
  if (validItems.length === 0) return '空会话';
  const first = validItems[0].translated;
  if (validItems.length <= 2) {
    return first.length > 10 ? first.substring(0, 10) + '...' : first;
  }
  return first.length > 6 ? first.substring(0, 6) + ` 等 ${validItems.length} 条翻译` : first + ` 等 ${validItems.length} 条翻译`;
}

export function useCorrection() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);

  const liveCacheRef = useRef<Map<string, Subtitle>>(new Map());
  const confirmTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const startTimeRef = useRef(Date.now());
  const activeSessionIdRef = useRef<string | null>(null);
  const hintShowingRef = useRef(false);
  /** 流式显示缓冲：累积完整句子后再显示，避免逐字跳动 */
  const displayBufferRef = useRef<{ text: string; original: string; segmentId: string }>({ text: '', original: '', segmentId: '' });
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { saveSessions(sessions); }, [sessions]);

  /** 创建新会话 */
  const createSession = useCallback((language: string = 'en'): string => {
    // 先结束当前活跃会话
    if (activeSessionIdRef.current) {
      finalizeCurrentSession();
    }

    const id = genId();
    const newSession: Session = {
      id,
      startTime: Date.now(),
      language,
      items: [],
      isActive: true,
      isExpanded: false,
    };

    setSessions((prev) => [newSession, ...prev]); // 新会话插入顶部
    activeSessionIdRef.current = id;
    setSubtitles([]);
    startTimeRef.current = Date.now();
    liveCacheRef.current.clear();
    hintShowingRef.current = false;
    if (streamTimerRef.current) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
    displayBufferRef.current = { text: '', original: '', segmentId: '' };

    console.log('[Session] 新建会话:', id, '语言:', language);
    return id;
  }, []);

  /** 结束当前会话 */
  const finalizeCurrentSession = useCallback(() => {
    // 先把 liveCache 中所有未确认的条目写入历史（跳过系统提示）
    const ids = Array.from(liveCacheRef.current.keys());
    for (const id of ids) {
      const item = liveCacheRef.current.get(id);
      if (item && (isSystemHint(item.text) || isMeaningless(item.text))) {
        liveCacheRef.current.delete(id);
        continue;
      }
      const timer = confirmTimersRef.current.get(id);
      if (timer) { clearTimeout(timer); confirmTimersRef.current.delete(id); }
      const refineTimer = confirmTimersRef.current.get(`refine-${id}`);
      if (refineTimer) { clearTimeout(refineTimer); confirmTimersRef.current.delete(`refine-${id}`); }
      finalizeSegment(id);
    }

    // 标记会话为非活跃
    const sessionId = activeSessionIdRef.current;
    if (sessionId) {
      setSessions((prev) =>
        prev.map((s) => s.id === sessionId ? { ...s, isActive: false, endTime: Date.now() } : s)
      );
      console.log('[Session] 结束会话:', sessionId);
    }
    activeSessionIdRef.current = null;
  }, []);

  /** 将 liveCache 中的条目确认并写入历史 */
  const finalizeSegment = useCallback((segmentId: string) => {
    const item = liveCacheRef.current.get(segmentId);
    if (!item) return;

    const historyItem: HistoryItem = {
      id: item.id,
      sessionId: item.sessionId,
      timestamp: item.timestamp,
      original: item.original,
      translated: item.text,
      status: 'confirmed',
    };

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== item.sessionId) return s;
        if (s.items.some((i) => i.id === segmentId)) return s;
        return { ...s, endTime: item.timestamp, items: [...s.items, historyItem] };
      })
    );

    liveCacheRef.current.delete(segmentId);
  }, []);

  /** 显示提示（不入历史，不重复） */
  const showHint = useCallback((text: string) => {
    if (hintShowingRef.current) return;
    hintShowingRef.current = true;
    const segmentId = `hint-${Date.now()}`;
    const now = Date.now();
    const sessionId = activeSessionIdRef.current;
    setSubtitles((prev) => [...prev, {
      id: segmentId, text, original: '', status: 'hint' as SubtitleStatus,
      timestamp: now, startTime: now - startTimeRef.current, sessionId: sessionId || '',
    }]);
  }, []);

  /** 显示真实翻译字幕（替换提示） */
  const showRealSubtitle = useCallback((segmentId: string, text: string, original: string) => {
    const now = Date.now();
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;

    hintShowingRef.current = false;
    setSubtitles((prev) => {
      const withoutHints = prev.filter((s) => s.status !== 'hint');
      const existing = withoutHints.find((s) => s.id === segmentId);
      if (existing) return withoutHints.map((s) => s.id === segmentId ? { ...s, text, original: original || s.original, status: 'live' as SubtitleStatus } : s);
      return [...withoutHints, {
        id: segmentId, text, original, status: 'live' as SubtitleStatus,
        timestamp: now, startTime: now - startTimeRef.current, sessionId,
      }];
    });
  }, []);

  /** 添加新的翻译片段（流式缓冲：累积完整句子后再显示） */
  const addTranslation = useCallback(
    (segmentId: string, text: string, isFinal: boolean, original: string = '') => {
      let sessionId = activeSessionIdRef.current;
      if (!sessionId) {
        sessionId = createSession('en');
      }

      if (!isFinal) {
        // ── 流式片段：累积到缓冲 ──
        const buf = displayBufferRef.current;
        if (buf.segmentId !== segmentId) {
          // 新 segment 开始，清空旧缓冲和定时器
          if (streamTimerRef.current) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
          displayBufferRef.current = { text, original, segmentId };
        } else {
          buf.text += text;
          buf.original += original;
        }

        // 纯标点/无意义 → 不显示
        if (isMeaningless(buf.text)) return;

        // 句号/问号/感叹号结尾 或 超过 20 字 → 立即显示
        const trimmed = buf.text.trim();
        if (/[。！？.?!]$/.test(trimmed) || trimmed.length > 20) {
          if (streamTimerRef.current) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
          showRealSubtitle(segmentId, buf.text, buf.original);
        } else if (trimmed.length >= 5) {
          // 5 个字以上 → 显示（不等句子结束）
          if (streamTimerRef.current) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
          showRealSubtitle(segmentId, buf.text, buf.original);
        } else if (!streamTimerRef.current) {
          // 不够 5 个字 → 300ms 后强制显示
          streamTimerRef.current = setTimeout(() => {
            streamTimerRef.current = null;
            const b = displayBufferRef.current;
            if (b.text && b.segmentId === segmentId && !isMeaningless(b.text)) {
              showRealSubtitle(segmentId, b.text, b.original);
            }
          }, 300);
        }
      } else {
        // ── 最终结果 ──
        if (streamTimerRef.current) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
        displayBufferRef.current = { text: '', original: '', segmentId: '' };

        // 过滤系统提示、短碎片、无意义文本
        if (isSystemHint(text) || text.trim().length <= 2 || isMeaningless(text)) {
          if (!hintShowingRef.current) showHint('说吧，我在听...');
          liveCacheRef.current.delete(segmentId);
          return;
        }

        // 清除提示，显示最终完整译文
        showRealSubtitle(segmentId, text, original);

        // 写入 liveCache（只有完整翻译才入历史）
        const now = Date.now();
        liveCacheRef.current.set(segmentId, {
          id: segmentId, text, original, status: 'live',
          timestamp: now, startTime: now - startTimeRef.current, sessionId,
        });

        // 3 秒后确认并写入历史
        const timer = setTimeout(() => {
          setSubtitles((prev) => prev.map((s) => s.id === segmentId ? { ...s, status: 'confirmed' } : s));
          finalizeSegment(segmentId);
          confirmTimersRef.current.delete(segmentId);
        }, 3000);
        confirmTimersRef.current.set(segmentId, timer);
      }
    },
    [createSession, finalizeSegment, showHint, showRealSubtitle]
  );

  /** 应用修正 */
  const applyCorrection = useCallback(
    (segmentId: string, newText: string, _reason: string) => {
      const cached = liveCacheRef.current.get(segmentId);
      if (cached) { cached.text = newText; cached.status = 'refined'; }

      setSubtitles((prev) =>
        prev.map((s) => s.id === segmentId ? { ...s, text: newText, status: 'refined' as SubtitleStatus } : s)
      );

      const timer = setTimeout(() => {
        setSubtitles((prev) => prev.map((s) => s.id === segmentId && s.status === 'refined' ? { ...s, status: 'confirmed' } : s));
        finalizeSegment(segmentId);
        confirmTimersRef.current.delete(`refine-${segmentId}`);
      }, 2000);
      confirmTimersRef.current.set(`refine-${segmentId}`, timer);
    },
    [finalizeSegment]
  );

  /** 删除单个会话 */
  const deleteSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== sessionId);
      saveSessions(filtered);
      return filtered;
    });
    // 如果删除的是当前活跃会话
    if (activeSessionIdRef.current === sessionId) {
      activeSessionIdRef.current = null;
      setSubtitles([]);
    }
  }, []);

  const toggleSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, isExpanded: !s.isExpanded } : s));
  }, []);

  const clearSubtitles = useCallback(() => {
    confirmTimersRef.current.forEach((t) => clearTimeout(t));
    confirmTimersRef.current.clear();
    liveCacheRef.current.clear();
    if (streamTimerRef.current) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
    displayBufferRef.current = { text: '', original: '', segmentId: '' };
    setSubtitles([]);
    setSessions([]);
    activeSessionIdRef.current = null;
    startTimeRef.current = Date.now();
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  /** 导出单个会话为 TXT（纯前端，和 SRT 一样直接下载） */
  const exportSessionTxt = useCallback((sessionId: string, mode: 'original_first' | 'bilingual' | 'translation_only' = 'bilingual') => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const items = session.items.filter((item) => item.translated?.trim() && item.translated.trim().length > 2);
    if (items.length === 0) return;

    const ts = new Date().toLocaleString('zh-CN');
    let content = '';

    if (mode === 'original_first') {
      content = `翻译记录\r\n导出时间: ${ts}\r\n\r\n══════ 原文 ══════\r\n\r\n`;
      items.forEach((it, i) => { content += `${i + 1}. ${it.original}\r\n`; });
      content += `\r\n══════ 译文 ══════\r\n\r\n`;
      items.forEach((it, i) => { content += `${i + 1}. ${it.translated}\r\n`; });
    } else if (mode === 'bilingual') {
      content = `翻译记录（双语对照）\r\n导出时间: ${ts}\r\n\r\n`;
      items.forEach((it, i) => {
        content += `[${i + 1}] 原文: ${it.original}\r\n    译文: ${it.translated}\r\n\r\n`;
      });
    } else {
      content = `翻译记录\r\n导出时间: ${ts}\r\n\r\n`;
      items.forEach((it, i) => { content += `${i + 1}. ${it.translated}\r\n`; });
    }

    const filename = `翻译_${new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)}.txt`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    return true;
  }, [sessions]);

  const exportSRT = useCallback((): SubtitleEntry[] => {
    const allItems = sessions.flatMap((s) => s.items);
    return allItems.map((item, i) => ({
      id: String(i + 1),
      text: item.translated,
      startTime: item.timestamp - startTimeRef.current,
      endTime: i < allItems.length - 1 ? allItems[i + 1].timestamp - startTimeRef.current : item.timestamp - startTimeRef.current + 3000,
    }));
  }, [sessions]);

  return {
    sessions,
    subtitles,
    activeSessionId: activeSessionIdRef.current,
    createSession,
    finalizeCurrentSession,
    addTranslation,
    applyCorrection,
    deleteSession,
    toggleSession,
    clearSubtitles,
    exportSRT,
    exportSessionTxt,
    generateSessionTitle,
    showHint,
  };
}
