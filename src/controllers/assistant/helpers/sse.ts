import type { Response } from 'express';

export function sseWriteData(res: Response, text: string) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');
  for (const p of parts) {
    res.write(`data: ${p}\n`);
  }
  res.write('\n');
  if ((res as any).flush) {
    try { (res as any).flush(); } catch {}
  }
}