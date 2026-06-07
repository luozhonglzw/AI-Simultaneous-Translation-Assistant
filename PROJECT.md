# AI 同声传译助手 - 项目文档

## 项目简介

AI 同声传译助手是一款基于大语言模型的实时语音翻译工具，能够将外语（英语、日语、韩语、法语、德语等）音频流实时翻译为中文字幕。项目采用 **Multi-Agent 消息总线架构**，各模块独立运行、自主决策，实现了端到端 2-3 秒的低延迟翻译体验。

### 应用场景

- **国际会议**：实时翻译演讲内容，生成双语字幕
- **在线课程**：观看外语教学视频时获取中文翻译
- **跨国沟通**：商务会议中的实时语言桥接
- **字幕制作**：导出 SRT 字幕文件用于视频后期

---

## 核心功能

### 1. 实时语音翻译

- 支持两种音频采集模式：**标签页音频**（捕获浏览器播放的声音）和**麦克风**（采集外部环境音）
- 基于 Web Audio API 的 `SemanticAudioBuffer` 实现语义断句：根据静音检测自动分割语音片段
- 调用阿里云百炼 Qwen-Omni-Turbo 多模态模型，同时完成语音识别和翻译
- 流式输出：翻译结果逐字显示，端到端延迟 2-3 秒

### 2. Multi-Agent 消息总线架构（核心亮点）

项目最大的技术特色是将传统单管道处理重构为 **4 个独立 Agent** 的协作系统：

```
                    ┌─────────────────────────────────┐
                    │        Multi-Agent 消息总线        │
                    │       (AgentCoordinator)         │
                    └──────┬──────┬──────┬──────┬──────┘
                           │      │      │      │
                ┌──────────▼┐ ┌───▼────┐ ┌▼─────┐ ┌▼──────────┐
                │ Agent 1   │ │Agent 2 │ │Agent 3│ │ Agent 4   │
                │ 音频监听   │ │ 翻译   │ │ 组装  │ │ 文档导出   │
                └───────────┘ └────────┘ └───────┘ └───────────┘
```

#### Agent 1：音频监听 Agent（AudioListenerAgent）

- **职责**：音频分类与过滤
- **零 API 调用**：纯本地计算，基于时域特征（RMS、零穿越率、短时能量方差）判断音频类型
- **分类能力**：语音 / 静音 / 掌声 / 音乐 / 噪声
- **自主决策**：语音片段转发给翻译 Agent，掌声/音乐直接通知前端跳过，长时间静音触发句子结束信号

#### Agent 2：翻译 Agent（TranslatorAgent）

- **职责**：调用 AI API 完成翻译
- **LRU 缓存**：相同音频指纹命中缓存，避免重复 API 调用
- **限流控制**：每秒最多 10 次 API 调用，超限自动排队
- **自动重试**：429 错误自动延迟重试，用户无感知
- **上下文窗口**：保留最近 5 条翻译结果作为上下文，提高翻译连贯性

#### Agent 3：组装 Agent（AssemblerAgent）

- **职责**：将翻译片段组装为完整句子
- **句子检测**：根据标点符号（句号、问号、感叹号）判断句子边界
- **超时管理**：3 秒无新内容则强制发送，避免卡住
- **缓冲策略**：保留最后 1 个片段作为上下文，确保语义连贯

#### Agent 4：文档导出 Agent（DocumentExportAgent）

- **职责**：生成可下载的翻译文档
- **支持格式**：TXT（纯文本）和 DOCX（Word 文档）
- **三种排版**：双语对照、原文优先、仅译文
- **纯后端生成**：自建 ZIP 构建器生成 DOCX，无需第三方压缩库

#### AgentCoordinator（协调器）

- **消息路由**：Agent 之间通过协调器路由消息，不直接调用
- **前端桥接**：管理 WebSocket 连接，将 Agent 消息转发给对应客户端
- **生命周期管理**：统一启动/停止所有 Agent

#### 与传统单管道架构的对比

| 特性 | 传统单管道 | Multi-Agent 架构 |
|------|-----------|-----------------|
| 模块耦合 | 高，函数直接调用 | 低，消息驱动 |
| 错误隔离 | 一个模块出错整体挂掉 | 单 Agent 故障不影响其他 |
| 扩展性 | 修改主流程 | 新增 Agent 即可 |
| 并发控制 | 手动管理 | Agent 自主限流 |
| 缓存策略 | 分散在各处 | 翻译 Agent 统一管理 |

### 3. 智能音频分类

前端和后端各有一套音频分类器，形成双重过滤：

**前端分类器**（`audioClassifier.ts`）：
- 在音频采集端快速过滤，减少无效数据传输
- 基于 RMS 音量、零穿越率、短时能量方差三个时域特征
- 无需 FFT，计算开销极低

**后端分类器**（`AudioListenerAgent`）：
- 更精细的分类，区分掌声、音乐、噪声
- 分类结果驱动不同处理路径

分类阈值设计：

| 音频类型 | RMS | 零穿越率 | 能量方差 |
|---------|-----|---------|---------|
| 语音 | ≥ 0.015 | 0.04 - 0.25 | - |
| 静音 | < 0.008 | - | - |
| 掌声 | - | > 0.25 | > 0.5 |
| 音乐 | > 0.08 | < 0.03 | < 0.1 |
| 噪声 | - | > 0.3 | - |

### 4. 会话管理

- **自动新建**：点击录音按钮自动创建新会话
- **暂停续录**：暂停录音不结束会话，可继续录制
- **切换语言**：自动结束当前会话并创建新会话
- **历史记录**：左侧时间轴展示所有会话，支持折叠/展开
- **会话标题**：自动生成（取首条翻译内容）
- **删除会话**：单个删除或清空全部
- **本地持久化**：会话数据存储在 localStorage

### 5. 双语字幕显示

- **实时翻译**：大号绿色文字，逐字流式显示，带闪烁光标
- **原文对照**：下方灰色小字显示英文原文
- **上一句保留**：上一句翻译以半透明显示，新句子出现时有过渡动画
- **状态指示**：live（绿色）→ refined（蓝色优化）→ confirmed（白色确认）
- **提示状态**：系统提示以斜体灰色显示

### 6. 文档导出

支持多种格式和排版模式：

| 格式 | 说明 |
|------|------|
| SRT | 标准字幕文件，可导入视频编辑软件 |
| TXT | 纯文本，支持三种排版模式 |
| DOCX | Word 文档，支持三种排版模式 |

三种排版模式：
- **双语对照**：原文和译文逐条对应
- **原文优先**：先列出所有原文，再列出所有译文
- **仅译文**：只包含翻译结果

### 7. 多语言支持

支持 5 种源语言 → 中文翻译：

| 语言 | 代码 |
|------|------|
| English | en |
| 日本語 | ja |
| 한국어 | ko |
| Français | fr |
| Deutsch | de |

### 8. 语音播报（TTS）

- 可选开启中文 TTS 语音输出
- 翻译完成后自动朗读中文译文

---

## 技术架构

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    浏览器前端                          │
│  React 18 + TypeScript + Tailwind CSS + Vite         │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │音频采集   │ │字幕显示   │ │会话历史   │ │文档导出  │ │
│  │AudioCap  │ │Subtitle  │ │History   │ │Export   │ │
│  └────┬─────┘ └────▲─────┘ └──────────┘ └─────────┘ │
│       │            │                                 │
│       └──WebSocket──┘                                │
└───────────────┬─────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────┐
│                   Node.js 后端                        │
│  Express + WebSocket (ws)                            │
│                                                      │
│  ┌─────────────────────────────────────────────┐     │
│  │          AgentCoordinator（消息总线）          │     │
│  │                                             │     │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────┴───┐ │
│  │  │音频监听  │→│ 翻译    │→│ 组装    │ │文档导出  │ │
│  │  │Agent 1  │ │Agent 2  │ │Agent 3  │ │Agent 4  │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
│  └─────────────────────────────────────────────┘     │
│                      │                               │
│              ┌───────▼───────┐                       │
│              │ 阿里云百炼 API  │                       │
│              │ Qwen-Omni     │                       │
│              └───────────────┘                       │
└─────────────────────────────────────────────────────┘
```

### 数据流

```
用户音频输入
    │
    ▼
[前端] AudioCapture → SemanticAudioBuffer（语义断句）
    │
    ▼ WebSocket (base64 WAV)
[后端] AgentCoordinator
    │
    ▼
[Agent 1] AudioListenerAgent（音频分类）
    │
    ├─ 语音 ──────────────────▼
    │                    [Agent 2] TranslatorAgent
    │                         │
    │                         ├─ 流式翻译 → 前端实时显示
    │                         │
    │                         ▼
    │                    [Agent 3] AssemblerAgent（组装完整句子）
    │                         │
    │                         ▼
    │                    前端：确认译文 + 原文对照
    │
    ├─ 掌声/音乐 ────────────▼
    │                    前端：显示环境音提示，跳过翻译
    │
    └─ 长时间静音 ───────────▼
                         [Agent 3] 强制结束当前句子
```

---

## 项目目录结构

```
AI-Simultaneous-Translation-Assistant/
├── README.md                           # 项目说明
├── PROJECT.md                          # 本文档
├── LICENSE                             # MIT 许可证
├── .env.example                        # 环境变量模板
├── .gitignore
│
├── src/
│   ├── frontend/                       # React 前端
│   │   ├── index.html                  # 入口 HTML
│   │   ├── package.json                # 前端依赖
│   │   ├── vite.config.ts              # Vite 配置
│   │   ├── tailwind.config.js          # Tailwind 配置
│   │   ├── postcss.config.js           # PostCSS 配置
│   │   ├── tsconfig.json               # TypeScript 配置
│   │   └── src/
│   │       ├── main.tsx                # React 入口
│   │       ├── App.tsx                 # 主应用组件
│   │       ├── index.css               # 全局样式
│   │       ├── vite-env.d.ts           # Vite 类型声明
│   │       │
│   │       ├── components/             # UI 组件
│   │       │   ├── AudioCapture.tsx    # 音频采集（标签页/麦克风）
│   │       │   ├── SubtitleDisplay.tsx # 字幕显示（双语+状态）
│   │       │   ├── TranslationHistory.tsx  # 翻译历史侧边栏
│   │       │   ├── LanguageSelector.tsx    # 语言选择器
│   │       │   └── TTSToggle.tsx       # TTS 开关
│   │       │
│   │       ├── hooks/                  # React Hooks
│   │       │   ├── useWebSocket.ts     # WebSocket 连接管理
│   │       │   ├── useCorrection.ts    # 翻译状态管理（核心）
│   │       │   └── useAudioStream.ts   # 音频流处理
│   │       │
│   │       ├── services/               # 业务服务
│   │       │   ├── audioClassifier.ts  # 音频分类器（前端）
│   │       │   ├── audioEncoder.ts     # 音频编码
│   │       │   ├── wavEncoder.ts       # WAV 编码
│   │       │   └── subtitleExporter.ts # SRT 字幕导出
│   │       │
│   │       └── utils/                  # 工具函数
│   │           └── docxGenerator.ts    # 前端 DOCX 生成器
│   │
│   └── backend/                        # Node.js 后端
│       ├── package.json                # 后端依赖
│       ├── tsconfig.json               # TypeScript 配置
│       └── src/
│           ├── server.ts               # 服务器入口（HTTP + WebSocket）
│           │
│           ├── agents/                 # Multi-Agent 系统
│           │   ├── BaseAgent.ts        # Agent 基类（消息队列+决策循环）
│           │   ├── AgentCoordinator.ts # 协调器（消息总线路由）
│           │   ├── AudioListenerAgent.ts   # Agent 1: 音频监听
│           │   ├── TranslatorAgent.ts      # Agent 2: 翻译
│           │   ├── AssemblerAgent.ts       # Agent 3: 组装
│           │   └── DocumentExportAgent.ts  # Agent 4: 文档导出
│           │
│           ├── services/               # 服务层
│           │   ├── unifiedAIService.ts  # 阿里云百炼 API 封装
│           │   └── correctionEngine.ts  # 纠错引擎
│           │
│           ├── types/                  # 类型定义
│           │   └── index.ts
│           │
│           └── utils/                  # 工具函数
│               └── audioBuffer.ts      # 音频缓冲处理
```

---

## 环境变量

| 变量 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key | 是 | - |
| `MODEL_ID` | 模型 ID | 否 | `qwen-omni-turbo` |
| `DASHSCOPE_BASE_URL` | API 基础 URL | 否 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `BACKEND_PORT` | 后端 HTTP 端口 | 否 | `3001` |
| `WS_PORT` | WebSocket 端口 | 否 | `3002` |
| `VITE_WS_URL` | 前端 WebSocket 地址 | 否 | `ws://localhost:3002` |

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/luozhonglzw/AI-Simultaneous-Translation-Assistant.git
cd AI-Simultaneous-Translation-Assistant
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的百炼 API Key
```

### 3. 启动后端

```bash
cd src/backend
npm install
npm run dev
```

后端运行在 `http://localhost:3001`（HTTP）和 `ws://localhost:3002`（WebSocket）。

### 4. 启动前端

```bash
cd src/frontend
npm install
npm run dev
```

前端运行在 `http://localhost:5173`。

### 5. 使用

1. 打开浏览器访问 `http://localhost:5173`
2. 授予麦克风权限（麦克风模式）或选择标签页音频
3. 选择源语言
4. 点击录音按钮开始翻译
5. 查看实时双语字幕
6. 停止录音后可在左侧历史栏查看会话记录
7. 点击导出按钮下载 SRT/TXT/DOCX 文档

---

## 依赖说明

### 前端依赖

| 包名 | 用途 |
|------|------|
| react / react-dom | UI 框架 |
| typescript | 类型安全 |
| vite | 构建工具 |
| tailwindcss | 样式框架 |
| sonner | Toast 通知 |
| docx | Word 文档生成 |
| file-saver | 浏览器文件下载 |

### 后端依赖

| 包名 | 用途 |
|------|------|
| express | HTTP 服务器 |
| ws | WebSocket 服务 |
| cors | 跨域支持 |
| dotenv | 环境变量管理 |

---

## 演示视频

- [项目介绍与功能演示](https://www.bilibili.com/video/BV1ZnEJ6NErs/)
- [韩文实时翻译演示](https://www.bilibili.com/video/BV1ZnEJ6NEdj/)

---

## 许可证

[MIT](LICENSE)
