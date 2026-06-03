# AI 同声传译助手

实时 AI 同声传译，将外语音频流翻译成中文字幕，支持自动纠错。

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-green)

## 功能特性

- **实时翻译**：端到端延迟 2-3 秒，流式处理
- **自动纠错**：后续上下文揭示前文错误时自动修正已显示的字幕
- **多语言支持**：英语、日语、韩语、法语、德语 → 中文
- **语音播报**：可选 TTS 中文语音输出
- **字幕导出**：一键导出 SRT 字幕文件
- **深色主题**：玻璃态 UI，响应式设计

## 架构

```
音频输入 → 3秒分段 → Base64编码 → WebSocket → 后端
                                              ↓
后端音频缓冲区 → 百炼 Qwen-Omni API（流式）→ 中文翻译文本
                                              ↓
                              修正引擎（上下文一致性检查）
                                              ↓
                              WebSocket 推送 → 前端字幕渲染
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Tailwind CSS + Vite |
| 后端 | Node.js + Express + WebSocket (ws) |
| AI 服务 | 阿里云百炼 Qwen-Omni-Turbo（音频多模态） |
| 音频处理 | Web Audio API + MediaRecorder |

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
├── demo/
├── src/
│   ├── frontend/          # React 前端
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   └── ...
│   └── backend/           # Node.js 后端
│       ├── src/
│       │   ├── server.ts
│       │   ├── services/
│       │   ├── utils/
│       │   └── types/
│       └── ...
├── .env.example
├── .gitignore
└── LICENSE
```

## 许可证

[MIT](LICENSE)

## 更新日志
