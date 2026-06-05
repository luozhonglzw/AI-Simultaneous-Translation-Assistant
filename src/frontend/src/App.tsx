/**
 * AI 同声传译助手 - 主应用
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast, Toaster } from 'sonner';
import { AudioCapture } from './components/AudioCapture';
import { SubtitleDisplay } from './components/SubtitleDisplay';
import { LanguageSelector } from './components/LanguageSelector';
import { TTSToggle } from './components/TTSToggle';
import { TranslationHistory } from './components/TranslationHistory';
import { useWebSocket } from './hooks/useWebSocket';
import { useCorrection } from './hooks/useCorrection';
import { formatAsSRT, downloadSRT } from './services/subtitleExporter';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3002';

export default function App() {
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [showGuide, setShowGuide] = useState(() => !localStorage.getItem('si-guide-dismissed'));
  const [isRecording, setIsRecording] = useState(false);

  const {
    sessions,
    subtitles,
    createSession,
    finalizeCurrentSession,
    addTranslation,
    applyCorrection,
    deleteSession,
    toggleSession,
    clearSubtitles,
    exportSRT,
    generateSessionTitle,
    showHint,
  } = useCorrection();

  const { state: wsState, sendAudio, sendConfig, onMessage } = useWebSocket({ url: WS_URL });

  useEffect(() => {
    onMessage((data: any) => {
      switch (data.type) {
        case 'translation':
          addTranslation(data.segmentId, data.text, data.isFinal, data.original || '');
          break;
        case 'correction':
          applyCorrection(data.segmentId, data.newText, data.reason);
          toast.info(`已优化: ${data.reason}`);
          break;
        case 'error':
          toast.error(data.message);
          break;
      }
    });
  }, [onMessage, addTranslation, applyCorrection]);

  /** 开始录音时新建会话，并显示一次提示 */
  const handleNewSession = useCallback((language: string) => {
    createSession(language);
    setIsRecording(true);
    // 显示一次提示，不重复
    setTimeout(() => showHint('说吧，我在听...'), 300);
  }, [createSession, showHint]);

  /** 停止录音时结束会话 */
  const handleEndSession = useCallback(() => {
    finalizeCurrentSession();
    setIsRecording(false);
  }, [finalizeCurrentSession]);

  /** 切换语言：如果正在录音，先结束旧会话再新建 */
  const handleLanguageChange = useCallback((lang: string) => {
    setSourceLanguage(lang);
    sendConfig(lang);

    if (isRecording) {
      finalizeCurrentSession();
      createSession(lang);
      toast.success(`语言已切换为 ${lang}，已新开会话`);
    } else {
      toast.success(`语言已切换为 ${lang}`);
    }
  }, [sendConfig, isRecording, finalizeCurrentSession, createSession]);

  const handleExport = useCallback(() => {
    const entries = exportSRT();
    if (entries.length === 0) { toast.warning('没有可导出的字幕'); return; }
    downloadSRT(formatAsSRT(entries));
    toast.success('SRT 字幕已导出');
  }, [exportSRT]);

  const noiseLabels: Record<string, string> = { noise: '👏 掌声/环境音', music: '🎵 背景音乐' };
  const handleNoiseDetected = useCallback((type: string) => {
    showHint(noiseLabels[type] || '🔊 环境音');
  }, [showHint]);

  const dismissGuide = () => { setShowGuide(false); localStorage.setItem('si-guide-dismissed', '1'); };

  const isConnected = wsState === 'connected';

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      <Toaster position="top-right" richColors />

      <TranslationHistory
        sessions={sessions}
        onToggleSession={toggleSession}
        onDeleteSession={deleteSession}
        onClear={clearSubtitles}
        generateTitle={generateSessionTitle}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="glass border-b border-white/10 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎙</span>
            <h1 className="text-lg font-bold">AI 同声传译助手</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span className="text-xs text-slate-400">{isConnected ? '已连接' : '未连接'}</span>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-white/5">
          <LanguageSelector value={sourceLanguage} onChange={handleLanguageChange} isRecording={isRecording} />
          <div className="flex items-center gap-2">
            <TTSToggle enabled={ttsEnabled} onToggle={() => setTtsEnabled(!ttsEnabled)} subtitles={subtitles} />
            <button onClick={handleExport} className="px-3 py-1.5 rounded-lg text-sm bg-white/5 text-slate-400 hover:bg-white/10 transition-all">导出 SRT</button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-8">
          <div className="w-full max-w-3xl">
            <SubtitleDisplay subtitles={subtitles} />
          </div>
        </div>

        <div className="pb-8">
          <AudioCapture
            isWsConnected={isConnected}
            onSendAudio={sendAudio}
            onNewSession={handleNewSession}
            onEndSession={handleEndSession}
            onNoiseDetected={handleNoiseDetected}
            currentLanguage={sourceLanguage}
          />
        </div>
      </div>

      {showGuide && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="glass rounded-2xl p-8 max-w-md mx-4">
            <h2 className="text-xl font-bold mb-4">使用说明</h2>
            <div className="space-y-3 text-sm text-slate-300">
              <div><h3 className="font-bold text-cyan-300">标签页音频模式</h3><p>选择浏览器标签页，翻译该标签页播放的声音。</p></div>
              <div><h3 className="font-bold text-cyan-300">麦克风模式</h3><p>使用麦克风采集外放音频，适合现场会议。</p></div>
              <div><h3 className="font-bold text-cyan-300">语义断句</h3><p>系统自动检测语音停顿，在句子结束时发送翻译。</p></div>
              <div><h3 className="font-bold text-cyan-300">会话管理</h3><p>每次开始录音自动创建新会话。切换语言会自动结束当前会话并开始新会话。</p></div>
            </div>
            <button onClick={dismissGuide} className="mt-6 w-full py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 transition-all">知道了</button>
          </div>
        </div>
      )}
    </div>
  );
}
