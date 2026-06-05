/**
 * 翻译历史侧边栏
 * - 会话卡片可折叠
 * - 自动标题
 * - 删除按钮（hover 显示）
 * - 空状态提示
 */

import type { Session, HistoryItem } from '../hooks/useCorrection';

// 系统提示词（与 useCorrection.ts 保持一致）
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

/** 过滤系统提示、纯标点、单字碎片（渲染级安全网） */
function isValidItem(item: HistoryItem): boolean {
  const text = item.translated?.trim() || '';
  if (!text) return false;
  if (text.length <= 2) return false; // 单字碎片
  if (/^[？?！!。，,\s\d.]+$/u.test(text)) return false; // 纯标点
  if (SYSTEM_HINTS.some((hint) => text.includes(hint))) return false; // 系统提示
  return true;
}

interface TranslationHistoryProps {
  sessions: Session[];
  onToggleSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onClear: () => void;
  generateTitle: (session: Session) => string;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(start: number, end?: number): string {
  const ms = (end || Date.now()) - start;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}秒`;
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}

const langLabels: Record<string, string> = {
  en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch',
};

export function TranslationHistory({ sessions, onToggleSession, onDeleteSession, onClear, generateTitle }: TranslationHistoryProps) {
  const totalItems = sessions.reduce((sum, s) => sum + s.items.filter(isValidItem).length, 0);

  const handleDelete = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定删除该会话？此操作不可恢复')) return;
    onDeleteSession(sessionId);
  };

  const handleClear = () => { if (confirm('确定要清空所有翻译历史吗？')) onClear(); };

  return (
    <aside className="w-[300px] h-full bg-slate-800 border-r border-slate-700 flex flex-col">
      <div className="p-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-300">
          翻译历史 {totalItems > 0 && `(${totalItems} 条 / ${sessions.length} 个会话)`}
        </h2>
        {sessions.length > 0 && (
          <button onClick={handleClear} className="text-xs text-slate-500 hover:text-red-400 transition-colors">清空</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <div className="text-4xl mb-2">📝</div>
            <div>暂无翻译记录</div>
            <div className="text-sm mt-1">点击开始录音创建新会话</div>
          </div>
        ) : (
          <div className="relative pl-6 pr-3 py-3">
            <div className="absolute left-3 top-0 bottom-0 w-px bg-slate-600" />

            {sessions.map((session) => (
              <div key={session.id} className="relative mb-4 last:mb-0">
                {/* 时间轴圆点 */}
                <div className={`absolute -left-3 top-2 w-2.5 h-2.5 rounded-full border-2 border-slate-800 ${session.isActive ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400'}`} />

                <div
                  className="ml-2 rounded-lg bg-slate-700/50 border border-slate-600/50 overflow-hidden cursor-pointer hover:border-slate-500/50 transition-all group"
                  onClick={() => onToggleSession(session.id)}
                >
                  {/* 会话头部 */}
                  <div className="px-3 py-2 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] text-slate-500 font-mono">
                          {formatTime(session.startTime)}
                        </span>
                        <span className="text-[10px] text-slate-600">
                          {langLabels[session.language] || session.language}
                        </span>
                        {session.isActive && (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1 py-0.5 rounded">录制中</span>
                        )}
                      </div>
                      <div className="text-sm text-slate-200 truncate">
                        {generateTitle(session)}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {session.items.filter(isValidItem).length} 条 · {formatDuration(session.startTime, session.endTime)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 ml-2">
                      {/* 删除按钮 */}
                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
                        title="删除会话"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                      {/* 展开箭头 */}
                      <svg className={`w-4 h-4 text-slate-500 transition-transform ${session.isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* 展开详情 */}
                  {session.isExpanded && (
                    <div className="border-t border-slate-600/50 px-3 py-2 space-y-3">
                      {session.items.filter(isValidItem).map((item) => (
                        <div key={item.id}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] text-slate-500 font-mono">{formatTime(item.timestamp)}</span>
                          </div>
                          {item.original && <p className="text-xs text-slate-400 mb-0.5">{item.original}</p>}
                          <p className="text-sm text-slate-100">{item.translated}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
