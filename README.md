# AI 同声传译助手

实时 AI 同声传译，将外语音频流翻译成中文字幕，支持自动纠错。基于 Multi-Agent 消息总线架构，各模块独立运行、自主决策。

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-green)

## 演示



https://github.com/user-attachments/assets/demo-video-1

https://github.com/user-attachments/assets/demo-video-2

## 功能特性

- **实时翻译**：端到端延迟 2-3 秒，流式输出
- **自动纠错**：后续上下文揭示前文错误时自动修正已显示的字幕
- **多语言支持**：英语、日语、韩语、法语、德语 → 中文
- **语音播报**：可选 TTS 中文语音输出
- **会话管理**：自动创建会话、历史记录、会话折叠/展开
- **文档导出**：支持 TXT / Word (DOCX) 导出，三种排版模式（双语对照、原文优先、仅译文）
- **字幕导出**：一键导出 SRT 字幕文件
- **环境音过滤**：自动识别掌声、背景音乐等非语音内容
- **深色主题**：玻璃态 UI，响应式设计

## 架构

```
                        ┌─────────────────────────────────┐
                        │        Multi-Agent 消息总线        │
                        │       (AgentCoordinator)         │
                        └──────┬──────┬──────┬──────┬──────┘
                               │      │      │      │
                    ┌──────────▼┐ ┌───▼────┐ ┌▼─────┐ ┌▼──────────┐
                    │ Agent 1   │ │Agent 2 │ │Agent 3│ │ Agent 4   │
                    │ 音频监听   │ │ 翻译   │ │ 组装  │ │ 文档导出   │
                    │ WAV解码    │ │ LRU缓存 │ │ 断句  │ │ TXT/DOCX  │
                    │ 特征提取   │ │ 限流    │ │ 缓冲  │ │ 纯前端    │
                    │ 分类过滤   │ │ 重试    │ │       │ │           │
                    └───────────┘ └────────┘ └───────┘ └───────────┘
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Tailwind CSS + Vite |
| 后端 | Node.js + Express + WebSocket (ws) |
| AI 服务 | 阿里云百炼 Qwen-Omni-Turbo（音频多模态） |
| 音频处理 | Web Audio API + MediaRecorder + SemanticAudioBuffer |
| 文档导出 | docx + file-saver（纯前端生成） |
| 架构模式 | Multi-Agent 消息总线（EventEmitter + 消息队列） |

## 本地运行

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的百炼 API Key
```

### 2. 启动后端

```bash
cd src/backend
npm install
npm run dev
```

后端将运行在 `http://localhost:3001`（HTTP）和 `ws://localhost:3002`（WebSocket）。

### 3. 启动前端

```bash
cd src/frontend
npm install
npm run dev
```

前端将运行在 `http://localhost:5173`。

### 4. 使用

1. 打开浏览器访问 `http://localhost:5173`
2. 授予麦克风权限
3. 选择源语言
4. 点击录音按钮开始翻译

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key | 是 |
| `MODEL_ID` | 模型 ID（默认 qwen-omni-turbo） | 否 |
| `DASHSCOPE_BASE_URL` | API 基础 URL | 否 |
| `BACKEND_PORT` | 后端 HTTP 端口（默认 3001） | 否 |
| `WS_PORT` | WebSocket 端口（默认 3002） | 否 |
| `VITE_WS_URL` | 前端 WebSocket 地址（默认 ws://localhost:3002） | 否 |

## 项目结构

```
AI-Simultaneous-Translation-Assistant/
├── README.md
├── demo-video/                # 演示视频
├── src/
│   ├── frontend/              # React 前端
│   │   ├── src/
│   │   │   ├── components/    # AudioCapture, SubtitleDisplay, TranslationHistory ...
│   │   │   ├── hooks/         # useWebSocket, useCorrection
│   │   │   ├── services/      # audioClassifier, subtitleExporter
│   │   │   ├── utils/         # docxGenerator（前端 DOCX 生成）
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   └── ...
│   └── backend/               # Node.js 后端
│       ├── src/
│       │   ├── agents/        # Multi-Agent 系统
│       │   │   ├── BaseAgent.ts
│       │   │   ├── AgentCoordinator.ts
│       │   │   ├── AudioListenerAgent.ts
│       │   │   ├── TranslatorAgent.ts
│       │   │   ├── AssemblerAgent.ts
│       │   │   └── DocumentExportAgent.ts
│       │   ├── server.ts
│       │   ├── services/
│       │   └── types/
│       └── ...
├── .env.example
├── .gitignore
└── LICENSE
```

## 许可证

[MIT](LICENSE)

## 更新日志
- 2026-06-03: 项目初始化，搭建前后端架构
- 2026-06-04: 集成WebSocket实时通信与阿里云百炼API
- 2026-06-05: 添加会话管理与文档导出功能
