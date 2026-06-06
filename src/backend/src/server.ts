/**
 * AI 同声传译助手 - 后端服务器
 * 真正的 Multi-Agent 架构：
 *   每个 Agent 独立运行，通过消息总线异步通信，自主决策
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { existsSync, mkdirSync } from 'fs';
import dotenv from 'dotenv';
import { AgentCoordinator } from './agents/AgentCoordinator.js';
import { AudioListenerAgent } from './agents/AudioListenerAgent.js';
import { TranslatorAgent } from './agents/TranslatorAgent.js';
import { AssemblerAgent } from './agents/AssemblerAgent.js';
import { DocumentExportAgent } from './agents/DocumentExportAgent.js';
import type { ConfigMessage } from './types/index.js';

dotenv.config({ path: '../../.env' });

const API_KEY = process.env.DASHSCOPE_API_KEY || '';
const HTTP_PORT = Number(process.env.BACKEND_PORT) || 3001;
const WS_PORT = Number(process.env.WS_PORT) || 3002;

if (!API_KEY) { console.error('错误：请配置 DASHSCOPE_API_KEY'); process.exit(1); }

const TEMP_DIR = 'temp';
if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

// ─── HTTP ───
const app = express();
app.use(cors());
app.use(express.json());
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: Date.now() }));
const httpServer = createServer(app);
httpServer.listen(HTTP_PORT, () => console.log(`[HTTP] http://localhost:${HTTP_PORT}`));

// ─── Multi-Agent 系统 ───
const coordinator = new AgentCoordinator();

const audioListener = new AudioListenerAgent();
const translator = new TranslatorAgent(API_KEY);
const assembler = new AssemblerAgent();
const exporter = new DocumentExportAgent();

coordinator.registerAgent(audioListener);
coordinator.registerAgent(translator);
coordinator.registerAgent(assembler);
coordinator.registerAgent(exporter);

coordinator.startAll();

// ─── WebSocket ───
const wss = new WebSocketServer({ port: WS_PORT, maxPayload: 10 * 1024 * 1024 });
let clientCounter = 0;

wss.on('connection', (ws) => {
  const clientId = `client-${++clientCounter}`;
  console.log(`[WS] 新客户端: ${clientId}`);
  coordinator.addClient(clientId, ws);

  let alive = true;
  const heartbeat = setInterval(() => {
    if (!alive) { clearInterval(heartbeat); ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, 30000);
  ws.on('pong', () => { alive = true; });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }

      if (msg.type === 'config') {
        const configMsg = msg as ConfigMessage;
        coordinator.setClientLanguage(clientId, configMsg.sourceLanguage);
        console.log(`[WS] ${clientId} 语言: ${configMsg.sourceLanguage}`);
        return;
      }

      if (msg.type === 'audio') {
        const segmentId = msg.segmentId || `seg-${Date.now()}`;
        // 音频交给 Agent 系统处理
        coordinator.handleAudio(clientId, msg.payload, segmentId);
      }

      if (msg.type === 'export_request') {
        // 导出请求交给 Agent 4
        console.log(`[WS] ${clientId} 导出请求: session=${msg.sessionId} format=${msg.format} mode=${msg.mode} items=${msg.items?.length}`);
        coordinator.handleExport(clientId, msg);
      }
    } catch (err) {
      console.error('[WS] 错误:', err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: '处理失败，请重试' }));
      }
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    coordinator.removeClient(clientId);
    console.log(`[WS] 客户端断开: ${clientId}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] 错误:', err);
    clearInterval(heartbeat);
    coordinator.removeClient(clientId);
  });
});

console.log(`[WS] ws://localhost:${WS_PORT}`);
console.log('[启动] 后端已就绪（Multi-Agent 消息总线架构）');

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n[关闭] 停止所有 Agent...');
  coordinator.stopAll();
  process.exit(0);
});

// API 预热
(async () => {
  try {
    const baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${API_KEY}` } });
    console.log('[WarmUp] API 预热完成');
  } catch { console.log('[WarmUp] 预热跳过'); }
})();
