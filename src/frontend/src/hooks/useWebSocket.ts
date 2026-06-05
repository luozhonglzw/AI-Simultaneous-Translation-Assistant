/**
 * WebSocket 连接管理 Hook
 * 自动重连（指数退避）、心跳检测、消息收发
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseWebSocketOptions {
  url: string;
  maxRetries?: number;
  heartbeatInterval?: number;
}

export function useWebSocket(options: UseWebSocketOptions) {
  const { url, maxRetries = 5, heartbeatInterval = 30000 } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>();
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [state, setState] = useState<ConnectionState>('disconnected');
  const messageCallbackRef = useRef<((data: any) => void) | null>(null);

  /** 连接 WebSocket */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setState('connecting');
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setState('connected');
      retryCountRef.current = 0;
      console.log('[WS] 已连接');

      // 启动心跳
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, heartbeatInterval);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return; // 心跳响应，忽略
        messageCallbackRef.current?.(data);
      } catch (err) {
        console.error('[WS] 消息解析失败:', err);
      }
    };

    ws.onclose = () => {
      clearInterval(heartbeatRef.current);
      setState('disconnected');
      console.log('[WS] 连接断开');
      attemptReconnect();
    };

    ws.onerror = (err) => {
      console.error('[WS] 连接错误:', err);
      setState('error');
    };

    wsRef.current = ws;
  }, [url, heartbeatInterval]);

  /** 指数退避重连 */
  const attemptReconnect = useCallback(() => {
    if (retryCountRef.current >= maxRetries) {
      console.log('[WS] 已达最大重试次数');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
    retryCountRef.current++;

    console.log(`[WS] ${delay}ms 后重连 (第 ${retryCountRef.current} 次)`);
    reconnectTimerRef.current = setTimeout(connect, delay);
  }, [connect, maxRetries]);

  /** 发送音频数据 */
  const sendAudio = useCallback(
    (base64Audio: string, segmentId: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn('[WS] 未连接，无法发送音频');
        return false;
      }

      wsRef.current.send(
        JSON.stringify({
          type: 'audio',
          payload: base64Audio,
          timestamp: Date.now(),
          segmentId,
        })
      );
      return true;
    },
    []
  );

  /** 发送配置变更 */
  const sendConfig = useCallback((sourceLanguage: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'config', sourceLanguage })
      );
    }
  }, []);

  /** 注册消息回调 */
  const onMessage = useCallback((callback: (data: any) => void) => {
    messageCallbackRef.current = callback;
  }, []);

  /** 断开连接 */
  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);
    clearInterval(heartbeatRef.current);
    retryCountRef.current = maxRetries; // 阻止自动重连
    wsRef.current?.close();
    wsRef.current = null;
    setState('disconnected');
  }, [maxRetries]);

  // 组件挂载时连接，卸载时断开
  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      clearInterval(heartbeatRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    state,
    sendAudio,
    sendConfig,
    onMessage,
    disconnect,
    reconnect: connect,
  };
}
