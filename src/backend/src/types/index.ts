/** 翻译片段状态 */
export type SegmentStatus = 'pending' | 'confirmed' | 'corrected';

/** 音频翻译片段 */
export interface Segment {
  id: string;
  audioStart: number;
  audioEnd: number;
  originalText: string;
  translatedText: string;
  status: SegmentStatus;
  confidence: number;
  timestamp: number;
}

/** WebSocket 消息类型 */
export type WSMessageType =
  | 'audio'
  | 'translation'
  | 'correction'
  | 'config'
  | 'error'
  | 'pong';

/** 客户端 → 服务端：音频数据 */
export interface AudioMessage {
  type: 'audio';
  payload: string; // Base64 编码的音频
  timestamp: number;
  segmentId: string;
}

/** 客户端 → 服务端：配置变更 */
export interface ConfigMessage {
  type: 'config';
  sourceLanguage: string;
}

/** 服务端 → 客户端：翻译结果 */
export interface TranslationMessage {
  type: 'translation';
  segmentId: string;
  text: string;
  original: string;
  isFinal: boolean;
  status: SegmentStatus;
}

/** 服务端 → 客户端：修正通知 */
export interface CorrectionMessage {
  type: 'correction';
  segmentId: string;
  oldText: string;
  newText: string;
  reason: string;
}

/** 服务端 → 客户端：错误 */
export interface ErrorMessage {
  type: 'error';
  message: string;
}

/** 服务端 → 客户端：心跳 */
export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

export type WSMessage =
  | AudioMessage
  | ConfigMessage
  | TranslationMessage
  | CorrectionMessage
  | ErrorMessage
  | PongMessage;
