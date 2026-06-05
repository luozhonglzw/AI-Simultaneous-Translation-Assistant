/**
 * 音频流管理 Hook
 * 麦克风采集 → MediaRecorder → 3秒分段 → Base64
 */

import { useCallback, useRef, useState } from 'react';
import { blobToBase64, generateSegmentId } from '../services/audioEncoder';

export type RecordingState = 'idle' | 'recording' | 'paused';

interface UseAudioStreamOptions {
  segmentDuration?: number;    // 分段时长（毫秒），默认 3000
  silenceThreshold?: number;   // 静音阈值（0~1），默认 0.01
  silenceTimeout?: number;     // 静音超时（毫秒），默认 1500
  onSegment?: (base64: string, segmentId: string) => void;
}

export function useAudioStream(options: UseAudioStreamOptions = {}) {
  const {
    segmentDuration = 3000,
    onSegment,
  } = options;

  const [state, setState] = useState<RecordingState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setInterval>>();
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>();

  /** 监测音频音量 */
  const monitorAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;
    setAudioLevel(avg);
    animFrameRef.current = requestAnimationFrame(monitorAudioLevel);
  }, []);

  /** 开始录音 */
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;

      // 创建音频分析器（用于音量监测）
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // MediaRecorder 使用 WAV 格式（如果支持）或 WebM
      const mimeType = MediaRecorder.isTypeSupported('audio/wav')
        ? 'audio/wav'
        : 'audio/webm;codecs=opus';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      let chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // 每 segmentDuration 切片一次
      recorder.start(segmentDuration);
      setState('recording');
      monitorAudioLevel();

      // 定时处理切片
      segmentTimerRef.current = setInterval(async () => {
        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: mimeType });
        chunks = [];

        // 如果录音已停止，不处理
        if (recorder.state !== 'recording') return;

        const base64 = await blobToBase64(blob);
        const segmentId = generateSegmentId();
        onSegment?.(base64, segmentId);
      }, segmentDuration);

      recorder.onerror = (e) => {
        console.error('[录音] MediaRecorder 错误:', e);
      };

      console.log('[录音] 已开始');
    } catch (err) {
      console.error('[录音] 获取麦克风失败:', err);
      throw err;
    }
  }, [segmentDuration, onSegment, monitorAudioLevel]);

  /** 停止录音 */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    clearInterval(segmentTimerRef.current);
    cancelAnimationFrame(animFrameRef.current!);
    analyserRef.current = null;
    streamRef.current = null;
    mediaRecorderRef.current = null;
    setState('idle');
    setAudioLevel(0);
    console.log('[录音] 已停止');
  }, []);

  return {
    state,
    audioLevel,
    startRecording,
    stopRecording,
    isRecording: state === 'recording',
  };
}
