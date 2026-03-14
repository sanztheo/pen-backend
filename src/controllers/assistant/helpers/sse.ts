import type { Response } from "express";

type ResponseWithFlush = Response & { flush: () => void };

function hasFlush(res: Response): res is ResponseWithFlush {
  return typeof (res as { flush?: unknown }).flush === "function";
}

export function sseWriteData(res: Response, text: string) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  for (const p of parts) {
    res.write(`data: ${p}\n`);
  }
  res.write("\n");
  if (hasFlush(res)) {
    try {
      res.flush();
    } catch {
      // Intentionally swallowed: flush may fail if response is already closed
    }
  }
}
