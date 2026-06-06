/**
 * Agent 协调器：消息总线 + 前端路由
 * Agent 之间通过协调器路由消息，不直接调用
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import type { BaseAgent, AgentMessage } from './BaseAgent.js';

interface ClientInfo {
  ws: WebSocket;
  language: string;
}

export class AgentCoordinator extends EventEmitter {
  private agents = new Map<string, BaseAgent>();
  private clients = new Map<string, ClientInfo>();
  private correctionTimers: ReturnType<typeof setInterval> | null = null;

  /** 注册 Agent */
  registerAgent(agent: BaseAgent): void {
    this.agents.set(agent.agentId, agent);

    // 监听 Agent 发往其他 Agent 的消息
    agent.on('send', (msg: { from: string; to: string; payload: any; clientId?: string }) => {
      this.routeMessage(msg.to, {
        type: msg.payload.type,
        payload: msg.payload,
        from: msg.from,
        clientId: msg.clientId,
        timestamp: Date.now(),
      });
    });

    // 监听 Agent 发往前端的消息
    agent.on('toFrontend', (payload: any, clientId?: string) => {
      this.sendToFrontend(payload, clientId);
    });
  }

  /** 启动所有 Agent */
  startAll(): void {
    this.agents.forEach((a) => a.start());

    // 后台精修：每 500ms 发一次修正请求给翻译 Agent
    this.correctionTimers = setInterval(() => {
      // 精修逻辑由翻译 Agent 自主管理
    }, 500);

    console.log('[Coordinator] 所有 Agent 已启动');
  }

  /** 停止所有 Agent */
  stopAll(): void {
    this.agents.forEach((a) => a.stop());
    if (this.correctionTimers) { clearInterval(this.correctionTimers); this.correctionTimers = null; }
  }

  /** 注册前端客户端 */
  addClient(clientId: string, ws: WebSocket): void {
    this.clients.set(clientId, { ws, language: 'en' });
  }

  /** 移除客户端 */
  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    // 通知所有 Agent 清理
    this.agents.forEach((a) => a.receiveMessage({
      type: 'client_disconnected',
      payload: { clientId },
      clientId,
      timestamp: Date.now(),
    }));
  }

  /** 设置客户端语言 */
  setClientLanguage(clientId: string, language: string): void {
    const client = this.clients.get(clientId);
    if (client) client.language = language;
  }

  /** 获取客户端语言 */
  getClientLanguage(clientId: string): string {
    return this.clients.get(clientId)?.language || 'en';
  }

  /** 外部输入音频 */
  handleAudio(clientId: string, audioBase64: string, segmentId: string): void {
    const language = this.getClientLanguage(clientId);
    this.routeMessage('audio-listener', {
      type: 'new_audio',
      payload: { audioBase64, segmentId, sourceLanguage: language },
      clientId,
      timestamp: Date.now(),
    });
  }

  /** 外部导出请求 */
  handleExport(clientId: string, exportData: any): void {
    console.log(`[Coordinator] 路由导出请求: clientId=${clientId} → document-export`);
    this.routeMessage('document-export', {
      type: 'export_request',
      payload: exportData,
      clientId,
      timestamp: Date.now(),
    });
  }

  /** 消息路由 */
  private routeMessage(targetAgentId: string, message: AgentMessage): void {
    const agent = this.agents.get(targetAgentId);
    if (agent) {
      agent.receiveMessage(message);
    } else {
      console.warn(`[Coordinator] 目标 Agent 不存在: ${targetAgentId}`);
    }
  }

  /** 发送消息到前端 */
  private sendToFrontend(payload: any, clientId?: string): void {
    const data = JSON.stringify(payload);

    if (clientId) {
      const client = this.clients.get(clientId);
      if (client?.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
        if (payload.type === 'export_ready') {
          console.log(`[Coordinator] export_ready 已发送给 ${clientId}, dataLen=${data.length}`);
        }
      } else {
        console.warn(`[Coordinator] 客户端 ${clientId} 不可达, state=${client?.ws.readyState}`);
      }
    } else {
      this.clients.forEach((c) => {
        if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
      });
    }
  }
}
