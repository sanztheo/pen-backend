// Minimal typings for pdf-parse to silence TS7016 and provide useful types
// Source shape based on runtime usage (text extraction only)

declare module "pdf-parse" {
  export interface PDFParseResult {
    text: string;
    info?: Record<string, any>;
    metadata?: any;
    version?: string;
    numpages?: number;
    numrender?: number;
  }

  function pdfParse(
    data: Buffer | Uint8Array | ArrayBuffer,
    options?: Record<string, any>,
  ): Promise<PDFParseResult>;

  export default pdfParse;
}

declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse, { PDFParseResult } from "pdf-parse";
  export type { PDFParseResult };
  export default pdfParse;
}
