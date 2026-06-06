/**
 * 前端 DOCX 生成器（纯浏览器端，不经过后端）
 */

import { Document, Paragraph, TextRun, Packer } from 'docx';
import { saveAs } from 'file-saver';

export interface ExportItem {
  original: string;
  translated: string;
}

export async function generateDocx(
  items: ExportItem[],
  mode: 'original_first' | 'bilingual' | 'translation_only' = 'bilingual'
): Promise<void> {
  const children: Paragraph[] = [];

  // 标题
  children.push(new Paragraph({
    children: [new TextRun({ text: '翻译记录', bold: true, size: 32 })],
    spacing: { after: 200 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: `生成时间: ${new Date().toLocaleString('zh-CN')}`, size: 20 })],
    spacing: { after: 400 },
  }));

  switch (mode) {
    case 'original_first':
      children.push(new Paragraph({
        children: [new TextRun({ text: '原文', bold: true, size: 28 })],
        spacing: { after: 200 },
      }));
      items.forEach((item, i) => {
        children.push(new Paragraph({
          children: [new TextRun({ text: `${i + 1}. ${item.original}`, size: 22 })],
          spacing: { after: 100 },
        }));
      });
      children.push(new Paragraph({
        children: [new TextRun({ text: '译文', bold: true, size: 28 })],
        spacing: { before: 400, after: 200 },
      }));
      items.forEach((item, i) => {
        children.push(new Paragraph({
          children: [new TextRun({ text: `${i + 1}. ${item.translated}`, size: 22 })],
          spacing: { after: 100 },
        }));
      });
      break;

    case 'bilingual':
      items.forEach((item, i) => {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `[${i + 1}] `, bold: true, size: 22 }),
            new TextRun({ text: '原文: ', bold: true, size: 22, color: '4472C4' }),
            new TextRun({ text: item.original, size: 22 }),
          ],
          spacing: { after: 50 },
        }));
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `[${i + 1}] `, bold: true, size: 22 }),
            new TextRun({ text: '译文: ', bold: true, size: 22, color: '70AD47' }),
            new TextRun({ text: item.translated, size: 22 }),
          ],
          spacing: { after: 200 },
        }));
      });
      break;

    case 'translation_only':
      items.forEach((item, i) => {
        children.push(new Paragraph({
          children: [new TextRun({ text: `${i + 1}. ${item.translated}`, size: 22 })],
          spacing: { after: 100 },
        }));
      });
      break;
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  const blob = await Packer.toBlob(doc);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  saveAs(blob, `翻译_${ts}.docx`);
}
