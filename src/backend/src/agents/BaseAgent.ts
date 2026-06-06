/**
 * Agent 基类：独立状态 + 消息队列 + 自主决策循环
 * 每个 Agent 通过 EventEmitter 通信，非直接函数调用
 */

import { EventEmitter } from 'events';

export interface AgentMessage {
  type: string;
  payload: any;
  from?: string;
  clientId?: string;
  timestamp: number;
}

export abstract class BaseAgent extends EventEmitter {
  readonly agentId: string;
  protected state = new Map<string, any>();
  private messageQueue: AgentMessage[] = [];
  private isRunning = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(agentId: string) {
    super();
    this.agentId = agentId;
  }

  /** 启动自主决策循环 */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.processLoop();
    console.log(`[${this.agentId}] 已启动`);
  }

  /** 停止 */
  stop(): void {
    this.isRunning = false;
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = null; }
    console.log(`[${this.agentId}] 已停止`);
  }

  /** 接收消息（来自协调器或其他 Agent） */
  receiveMessage(message: AgentMessage): void {
    this.messageQueue.push(message);
  }

  /** 发送消息给其他 Agent（通过协调器路由） */
  protected send(targetAgentId: string, type: string, payload: any, clientId?: string): void {
    this.emit('send', {
      from: this.agentId,
      to: targetAgentId,
      payload: { ...payload, type },
      clientId,
      timestamp: Date.now(),
    });
  }

  /** 发送消息到前端 */
  protected sendToFrontend(type: string, payload: any, clientId?: string): void {
    this.emit('toFrontend', { ...payload, type }, clientId);
  }

  /** 自主决策循环 */
  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        if (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift()!;
          await this.decideAndAct(msg);
        } else {
          await this.idleAction();
          await this.sleep(50);
        }
      } catch (err) {
        console.error(`[${this.agentId}] 循环错误:`, err);
        await this.sleep(100);
      }
    }
  }

  /** 抽象：处理消息时的自主决策 */
  protected abstract decideAndAct(message: AgentMessage): Promise<void>;

  /** 抽象：空闲时的自主行为 */
  protected abstract idleAction(): Promise<void>;

  protected setState(key: string, value: any): void { this.state.set(key, value); }
  protected getState<T = any>(key: string): T | undefined { return this.state.get(key); }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
