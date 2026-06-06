/**
 * Agent 4：文档导出 Agent（独立运行，不影响翻译）
 * 接收导出请求，生成 TXT/DOCX，返回文件下载
 */

import { BaseAgent, type AgentMessage } from './BaseAgent.js';

interface ExportItem {
  original: string;
  translated: string;
  timestamp: number;
}

type ExportMode = 'original_first' | 'bilingual' | 'translation_only';
type ExportFormat = 'txt' | 'docx';

export class DocumentExportAgent extends BaseAgent {
  constructor() {
    super('document-export');
  }

  protected async decideAndAct(message: AgentMessage): Promise<void> {
    if (message.type !== 'export_request') return;

    const { sessionId, format, mode, items } = message.payload as {
      sessionId: string;
      format: ExportFormat;
      mode: ExportMode;
      items: ExportItem[];
    };

    console.log(`[${this.agentId}] 收到导出请求: session=${sessionId} format=${format} mode=${mode} items=${items?.length} clientId=${message.clientId}`);

    try {
      if (!items || items.length === 0) {
        this.sendToFrontend('export_error', { error: '没有可导出的内容' }, message.clientId);
        return;
      }

      const content = this.generateContent(mode, items);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

      const base64 = Buffer.from(content, 'utf-8').toString('base64');
      const mimeType = format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'text/plain;charset=utf-8';
      const ext = format === 'docx' ? 'docx' : 'txt';
      const filename = `翻译_${timestamp}.${ext}`;

      const payload = {
        sessionId,
        format,
        filename,
        data: `data:${mimeType};base64,${base64}`,
      };

      console.log(`[${this.agentId}] 发送 export_ready: filename=${filename} dataLen=${payload.data.length} clientId=${message.clientId}`);
      this.sendToFrontend('export_ready', payload, message.clientId);
      console.log(`[${this.agentId}] 导出完成: ${format} / ${mode} / ${items.length} 条`);
    } catch (err: any) {
      console.error(`[${this.agentId}] 导出失败:`, err.message, err.stack);
      this.sendToFrontend('export_error', { error: err.message }, message.clientId);
    }
  }

  protected async idleAction(): Promise<void> {
    // 无待处理任务
  }

  private generateContent(mode: ExportMode, items: ExportItem[]): string {
    const ts = new Date().toLocaleString('zh-CN');

    switch (mode) {
      case 'original_first': {
        let r = `翻译记录\r\n导出时间: ${ts}\r\n\r\n`;
        r += `══════ 原文 ══════\r\n\r\n`;
        items.forEach((it, i) => { r += `${i + 1}. ${it.original}\r\n`; });
        r += `\r\n══════ 译文 ══════\r\n\r\n`;
        items.forEach((it, i) => { r += `${i + 1}. ${it.translated}\r\n`; });
        return r;
      }
      case 'bilingual': {
        let r = `翻译记录（双语对照）\r\n导出时间: ${ts}\r\n\r\n`;
        items.forEach((it, i) => {
          r += `[${i + 1}] 原文: ${it.original}\r\n`;
          r += `    译文: ${it.translated}\r\n\r\n`;
        });
        return r;
      }
      case 'translation_only': {
        let r = `翻译记录\r\n导出时间: ${ts}\r\n\r\n`;
        items.forEach((it, i) => { r += `${i + 1}. ${it.translated}\r\n`; });
        return r;
      }
    }
  }

  /** 生成最小可用 DOCX（ZIP 格式的 Office Open XML） */
  private generateDocx(content: string): string {
    const escXml = (s: string) => s.replace(/[<>&'"]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!)
    );

    const paragraphs = content.split(/\r?\n/).map((line) =>
      `<w:p><w:r><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`
    ).join('');

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal">
<w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/></w:rPr>
</w:style>
</w:styles>`;

    // Build ZIP manually (minimal ZIP format)
    const files: Array<{ name: string; data: string }> = [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/_rels/document.xml.rels', data: wordRels },
      { name: 'word/styles.xml', data: styles },
    ];

    return this.buildZip(files);
  }

  /** 最小 ZIP 文件构建器（无压缩，仅存储） */
  private buildZip(files: Array<{ name: string; data: string }>): string {
    const entries: Array<{ header: Buffer; data: Buffer; offset: number }> = [];
    const encoder = new TextEncoder();

    let offset = 0;
    const localHeaders: Buffer[] = [];
    const centralHeaders: Buffer[] = [];

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = Buffer.from(file.data, 'utf-8');
      const crc = this.crc32(dataBytes);

      // Local file header
      const local = Buffer.alloc(30 + nameBytes.length);
      local.writeUInt32LE(0x04034b50, 0); // signature
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0, 6); // flags
      local.writeUInt16LE(0, 8); // compression (store)
      local.writeUInt16LE(0, 10); // mod time
      local.writeUInt16LE(0, 12); // mod date
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(dataBytes.length, 18);
      local.writeUInt32LE(dataBytes.length, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      local.writeUInt16LE(0, 28); // extra length
      nameBytes.forEach((b, i) => local[30 + i] = b);

      localHeaders.push(local, dataBytes);

      // Central directory header
      const central = Buffer.alloc(46 + nameBytes.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4); // version made by
      central.writeUInt16LE(20, 6); // version needed
      central.writeUInt16LE(0, 8); // flags
      central.writeUInt16LE(0, 10); // compression
      central.writeUInt16LE(0, 12); // mod time
      central.writeUInt16LE(0, 14); // mod date
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(dataBytes.length, 20);
      central.writeUInt32LE(dataBytes.length, 24);
      central.writeUInt16LE(nameBytes.length, 28);
      central.writeUInt16LE(0, 30); // extra length
      central.writeUInt16LE(0, 32); // comment length
      central.writeUInt16LE(0, 34); // disk number
      central.writeUInt16LE(0, 36); // internal attrs
      central.writeUInt32LE(0, 38); // external attrs
      central.writeUInt32LE(offset, 42); // offset
      nameBytes.forEach((b, i) => central[46 + i] = b);

      centralHeaders.push(central);
      entries.push({ header: local, data: dataBytes, offset });
      offset += local.length + dataBytes.length;
    }

    const centralDirOffset = offset;
    const centralDirSize = centralHeaders.reduce((s, b) => s + b.length, 0);

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk
    eocd.writeUInt16LE(0, 6); // disk start
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20); // comment length

    const zip = Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
    return zip.toString('base64');
  }

  /** CRC32 */
  private crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}
