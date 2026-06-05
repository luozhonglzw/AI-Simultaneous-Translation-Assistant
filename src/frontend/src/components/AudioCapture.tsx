/**
 * 音频采集组件（语义断句 + 会话管理）
 * 开始录音 → 新建会话
 * 停止录音 → 结束会话
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { audioBufferToWav, wavBlobToBase64 } from '../services/wavEncoder';
import { generateSegmentId } from '../services/audioEncoder';
import { classifyAudio, type AudioType } from '../services/audioClassifier';

type CaptureMode = 'tab' | 'mic';

interface AudioCaptureProps {
  isWsConnected: boolean;
  onSendAudio: (base64: string, segmentId: string) => boolean;
  onNewSession: (language: string) => void;
  onEndSession: () => void;
  onNoiseDetected?: (type: string) => void;
  currentLanguage: string;
}

class SemanticAudioBuffer {
  private pcmBuffers: Float32Array[] = [];
  private silenceStart: number | null = null;
  private readonly silenceThreshold = 0.015;
  private readonly silenceDuration = 800;
  private readonly maxDuration = 6000;
  private readonly minDuration = 1000;
  private lastNoiseTime = 0;
  private onNoiseDetected?: (type: AudioType) => void;

  constructor(onNoiseDetected?: (type: AudioType) => void) {
    this.onNoiseDetected = onNoiseDetected;
  }

  append(pcm: Float32Array, volume: number): { pcm: Float32Array; duration: number } | null {
    const audioType = classifyAudio(pcm);

    // 静音：跟踪但不累积
    if (audioType === 'silence') {
      if (this.silenceStart === null) this.silenceStart = Date.now();
      // 如果已有语音缓冲，静音也累积（用于断句）
      if (this.pcmBuffers.length > 0) this.pcmBuffers.push(pcm);
    } else if (audioType === 'noise' || audioType === 'music') {
      // 环境音/音乐：丢弃，通知 UI
      this.silenceStart = null;
      const now = Date.now();
      if (now - this.lastNoiseTime > 3000) {
        this.lastNoiseTime = now;
        this.onNoiseDetected?.(audioType);
      }
      // 如果已有语音缓冲且环境音持续，立即发送已缓冲的语音
      if (this.pcmBuffers.length > 0) {
        const duration = this.getDuration();
        if (duration > this.minDuration) return this.flush();
      }
    } else {
      // 语音：正常累积
      this.pcmBuffers.push(pcm);
      this.silenceStart = null;
    }

    const duration = this.getDuration();
    const silenceTime = this.silenceStart ? Date.now() - this.silenceStart : 0;
    if ((silenceTime > this.silenceDuration && duration > this.minDuration) || duration > this.maxDuration) {
      return this.flush();
    }
    return null;
  }

  flush(): { pcm: Float32Array; duration: number } | null {
    if (this.pcmBuffers.length === 0) return null;
    const merged = this.merge(this.pcmBuffers);
    const duration = this.getDuration();
    this.pcmBuffers = [];
    this.silenceStart = null;
    if (duration < 500) return null;
    return { pcm: merged, duration };
  }

  private getDuration(): number {
    const total = this.pcmBuffers.reduce((s, b) => s + b.length, 0);
    return (total / 16000) * 1000;
  }

  private merge(arrays: Float32Array[]): Float32Array {
    const len = arrays.reduce((s, a) => s + a.length, 0);
    const result = new Float32Array(len);
    let off = 0;
    for (const a of arrays) { result.set(a, off); off += a.length; }
    return result;
  }
}

function generateTestWavBase64(): string {
  const sr = 16000, dur = 1, n = sr * dur, ds = n * 2;
  const buf = new ArrayBuffer(44 + ds), v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + ds, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, ds, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sr) * 0.3 * 32767, true);
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

function calculateVolume(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

export function AudioCapture({ isWsConnected, onSendAudio, onNewSession, onEndSession, onNoiseDetected, currentLanguage }: AudioCaptureProps) {
  const [mode, setMode] = useState<CaptureMode>('tab');
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [debugInfo, setDebugInfo] = useState('');
  const [showTabGuide, setShowTabGuide] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const semanticBufferRef = useRef(new SemanticAudioBuffer());
  const animFrameRef = useRef<number>();
  const analyserRef = useRef<AnalyserNode | null>(null);
  const debugAudioRef = useRef<HTMLDivElement>(null);

  const monitorLevel = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    setAudioLevel(data.reduce((a, b) => a + b, 0) / data.length / 255);
    animFrameRef.current = requestAnimationFrame(monitorLevel);
  }, []);

  const sendPcm = useCallback(async (pcm: Float32Array, duration: number) => {
    const sr = audioCtxRef.current?.sampleRate || 16000;
    const ab = audioCtxRef.current!.createBuffer(1, pcm.length, sr);
    ab.getChannelData(0).set(pcm);
    const wavBlob = audioBufferToWav(ab);
    console.log('[Audio] WAV:', wavBlob.size, '字节, 时长:', duration.toFixed(0), 'ms');
    if (debugAudioRef.current) {
      const url = URL.createObjectURL(wavBlob);
      const audio = document.createElement('audio');
      audio.controls = true; audio.src = url; audio.style.cssText = 'width:200px;height:30px;margin:2px;';
      debugAudioRef.current.appendChild(audio);
      setTimeout(() => { URL.revokeObjectURL(url); audio.remove(); }, 30000);
    }
    onSendAudio(await wavBlobToBase64(wavBlob), generateSegmentId());
  }, [onSendAudio]);

  const stopRecordingRef = useRef<(() => void) | null>(null);

  const doStartRecording = useCallback(async (stream: MediaStream) => {
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) {
      toast.error('未检测到音频轨道，请重新选择标签页并确保勾选"分享音频"');
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    tracks[0].onended = () => { toast.info('音频共享已结束'); stopRecordingRef.current?.(); };
    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    semanticBufferRef.current = new SemanticAudioBuffer(onNoiseDetected);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = proc;

    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      const vol = calculateVolume(copy);
      const result = semanticBufferRef.current.append(copy, vol);
      if (result) sendPcm(result.pcm, result.duration);
    };

    source.connect(proc);
    proc.connect(ctx.destination);
    setIsRecording(true);
    monitorLevel();
    setDebugInfo(`模式: ${mode === 'tab' ? '标签页' : '麦克风'}, 采样率: ${ctx.sampleRate}`);
    console.log('[录音] 已开始');
  }, [mode, monitorLevel, sendPcm, onNoiseDetected]);

  const stopRecording = useCallback(() => {
    const remaining = semanticBufferRef.current.flush();
    if (remaining) sendPcm(remaining.pcm, remaining.duration);
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(animFrameRef.current!);
    analyserRef.current = null;
    setIsRecording(false);
    setAudioLevel(0);
    // 结束会话
    onEndSession();
    console.log('[录音] 已停止');
  }, [sendPcm, onEndSession]);

  stopRecordingRef.current = stopRecording;

  const startRecording = useCallback(async () => {
    try {
      // 新建会话
      onNewSession(currentLanguage);

      if (mode === 'tab') {
        setShowTabGuide(true);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      await doStartRecording(stream);
    } catch (err: any) {
      console.error('[录音] 启动失败:', err);
      if (err.name === 'NotAllowedError') toast.error('麦克风权限被拒绝');
      else toast.error(`启动失败: ${err.message}`);
    }
  }, [mode, doStartRecording, onNewSession, currentLanguage]);

  const handleTabConfirm = useCallback(async () => {
    setShowTabGuide(false);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 16000 } as any,
      });
      stream.getVideoTracks().forEach((t) => t.stop());
      const audioStream = new MediaStream(stream.getAudioTracks());
      if (audioStream.getAudioTracks().length === 0) {
        toast.error('未检测到音频轨道。请勾选"分享音频"选项');
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await doStartRecording(audioStream);
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') toast.error(`启动失败: ${err.message}`);
    }
  }, [doStartRecording]);

  const handleReselect = useCallback(async () => { stopRecording(); await handleTabConfirm(); }, [stopRecording, handleTabConfirm]);

  const handleToggle = async () => {
    if (isRecording) stopRecording();
    else await startRecording();
  };

  const handleTestAudio = useCallback(() => {
    onNewSession(currentLanguage);
    onSendAudio(generateTestWavBase64(), generateSegmentId());
    setDebugInfo('已发送测试音频');
  }, [onSendAudio, onNewSession, currentLanguage]);

  useEffect(() => () => { if (isRecording) stopRecording(); }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex bg-slate-800 rounded-lg p-1 gap-1">
        <button onClick={() => setMode('tab')} className={`px-4 py-2 rounded-md text-sm transition-all ${mode === 'tab' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}>标签页音频</button>
        <button onClick={() => setMode('mic')} className={`px-4 py-2 rounded-md text-sm transition-all ${mode === 'mic' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}>麦克风</button>
      </div>

      <div className="flex items-center gap-6">
        <button
          onClick={handleToggle}
          disabled={!isWsConnected && !isRecording}
          className={`relative w-20 h-20 rounded-full transition-all duration-300 flex items-center justify-center ${isRecording ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/50' : isWsConnected ? 'bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/30' : 'bg-gray-600 cursor-not-allowed'}`}
        >
          {isRecording ? <div className="w-6 h-6 bg-white rounded-sm" /> : (
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
          {isRecording && <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-ping" />}
        </button>

        {isRecording && mode === 'tab' && (
          <button onClick={handleReselect} className="px-4 py-2 rounded-lg text-sm bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 transition-all">重新选择标签页</button>
        )}

        <button onClick={handleTestAudio} disabled={!isWsConnected} className="px-4 py-2 rounded-lg text-sm bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all">测试音频</button>
      </div>

      <p className="text-sm text-slate-400">
        {!isWsConnected ? '等待连接...' : isRecording ? `${mode === 'tab' ? '标签页' : '麦克风'}录音中，语义断句自动发送` : `${mode === 'tab' ? '标签页' : '麦克风'}模式，点击开始录音`}
      </p>

      {isRecording && (
        <div className="flex items-end gap-1 h-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="audio-wave-bar w-1 bg-cyan-400 rounded-full transition-all" style={{ height: `${Math.max(4, audioLevel * 120 * (0.3 + Math.random() * 0.7))}px` }} />
          ))}
        </div>
      )}

      {debugInfo && <p className="text-xs text-slate-500 font-mono">{debugInfo}</p>}
      <div ref={debugAudioRef} className="flex flex-col gap-1 max-w-md" />

      {showTabGuide && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="glass rounded-2xl p-8 max-w-md mx-4">
            <h2 className="text-xl font-bold mb-4">选择标签页</h2>
            <div className="space-y-3 text-sm text-slate-300">
              <p>请选择要翻译的浏览器标签页。</p>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <p className="text-amber-300 font-bold">重要：</p>
                <p>请务必勾选左下角的 <span className="text-white font-bold">"分享音频"</span> 选项。</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowTabGuide(false)} className="flex-1 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-all">取消</button>
              <button onClick={handleTabConfirm} className="flex-1 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 transition-all">我知道了</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
