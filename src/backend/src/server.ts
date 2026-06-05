/**
 * AI 同声传译助手 - 后端服务器
 * 翻译管道（实时，不阻塞） + 修正管道（后台队列）
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import dotenv from 'dotenv';
import { AudioBufferManager } from './utils/audioBuffer.js';
import {
  translateAudio,
  translateAudioNonStream,
  transcribeAudio,
} from './services/unifiedAIService.js';
import type { AudioMessage, ConfigMessage } from './types/index.js';

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

// ─── WebSocket ───
const wss = new WebSocketServer({ port: WS_PORT });
const audioBuffer = new AudioBufferManager();
const clientLanguages = new Map<WebSocket, string>();

let segmentCounter = 0;

function broadcast(data: string) {
  wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}

function sendTo(client: WebSocket, data: object) {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
}

// ─── 修正队列（后台，不阻塞翻译流） ───
interface CorrectionTask {
  segmentId: string;
  audioBase64: string;
  originalText: string;
  contextTexts: string[];
}

const correctionQueue: CorrectionTask[] = [];

// 后台修正处理：每 500ms 处理一批（最多 2 个）
const CORRECTION_INTERVAL = 500;
const CORRECTION_BATCH_SIZE = 2;

setInterval(async () => {
  if (correctionQueue.length === 0) return;
  const batch = correctionQueue.splice(0, CORRECTION_BATCH_SIZE);

  await Promise.all(batch.map(async (task) => {
    try {
      console.log(`[修正] 后台重新翻译: ${task.segmentId}`);
      const corrected = await translateAudioNonStream(
        task.audioBase64,
        API_KEY,
        { context: task.contextTexts, mode: 'accurate' }
      );

      if (corrected && corrected !== task.originalText) {
        console.log(`[修正] ${task.segmentId}: "${task.originalText.substring(0, 40)}" → "${corrected.substring(0, 40)}"`);
        broadcast(JSON.stringify({
          type: 'correction',
          segmentId: task.segmentId,
          oldText: task.originalText,
          newText: corrected,
          reason: '后台精修',
        }));
      } else {
        console.log(`[修正] ${task.segmentId}: 无变化`);
      }
    } catch (err: any) {
      console.error(`[修正] 失败 ${task.segmentId}:`, err.message);
    }
  }));
}, CORRECTION_INTERVAL);

// ─── WebSocket 连接处理 ───
wss.on('connection', (ws) => {
  console.log('[WS] 新客户端连接');
  clientLanguages.set(ws, 'en');

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

      if (msg.type === 'ping') { sendTo(ws, { type: 'pong', timestamp: Date.now() }); return; }

      if (msg.type === 'config') {
        const configMsg = msg as ConfigMessage;
        clientLanguages.set(ws, configMsg.sourceLanguage);
        console.log(`[WS] 语言设置: ${configMsg.sourceLanguage}`);
        return;
      }

      if (msg.type === 'audio') {
        const audioMsg = msg as AudioMessage;
        const segmentId = audioMsg.segmentId || `seg-${++segmentCounter}`;

        // 调试保存
        try {
          let b64 = audioMsg.payload;
          if (b64.startsWith('data:')) b64 = b64.substring(b64.indexOf(',') + 1);
          writeFileSync(`${TEMP_DIR}/debug-audio-${Date.now()}.wav`, Buffer.from(b64, 'base64'));
        } catch {}

        // 存入音频缓冲
        audioBuffer.append({ id: segmentId, data: audioMsg.payload, timestamp: audioMsg.timestamp, duration: 3 });

        // 获取上下文
        const contextTexts = audioBuffer.getContext(2).map((s) => s.id); // 简化上下文
        const sourceLang = clientLanguages.get(ws) || 'en';

        // ─── 主翻译管道（立即执行，不阻塞） ───
        let fullText = '';
        let originalText = '';

        // 并行：转录 + 流式翻译
        const transcribePromise = transcribeAudio(audioMsg.payload, API_KEY).then((t) => { originalText = t; });

        try {
          for await (const chunk of translateAudio(audioMsg.payload, API_KEY, { sourceLanguage: sourceLang, mode: 'fast' })) {
            fullText += chunk;
            sendTo(ws, {
              type: 'translation',
              segmentId,
              text: chunk,
              original: '',
              isFinal: false,
              status: 'live',
            });
          }
        } catch (apiErr: any) {
          console.error('[翻译] 失败:', apiErr.message);
          sendTo(ws, { type: 'error', message: `翻译失败: ${apiErr.message}` });
          return;
        }

        await transcribePromise;

        // 发送最终结果
        sendTo(ws, {
          type: 'translation',
          segmentId,
          text: fullText,
          original: originalText,
          isFinal: true,
          status: 'live',
        });

        console.log(`[翻译] ${segmentId}: ${fullText.substring(0, 60)}`);

        // ─── 加入修正队列（后台处理） ───
        correctionQueue.push({
          segmentId,
          audioBase64: audioMsg.payload,
          originalText: fullText,
          contextTexts: [],
        });
      }
    } catch (err) {
      console.error('[WS] 错误:', err);
      sendTo(ws, { type: 'error', message: '处理失败，请重试' });
    }
  });

  ws.on('close', () => { clearInterval(heartbeat); clientLanguages.delete(ws); console.log('[WS] 客户端断开'); });
  ws.on('error', (err) => { console.error('[WS] 错误:', err); clearInterval(heartbeat); clientLanguages.delete(ws); });
});

console.log(`[WS] ws://localhost:${WS_PORT}`);
console.log('[启动] 后端已就绪');

// API 预热：启动时发一个请求建立连接
(async () => {
  try {
    const baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${API_KEY}` } });
    console.log('[WarmUp] API 预热完成');
  } catch { console.log('[WarmUp] 预热跳过'); }
})();
