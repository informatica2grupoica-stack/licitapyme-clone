// Declaración mínima de tipos para word-extractor (lee .doc legacy / OLE).
declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string;
    getHeaders?(): string;
    getFooters?(): string;
    getFootnotes?(): string;
    getEndnotes?(): string;
    getAnnotations?(): string;
  }
  export default class WordExtractor {
    extract(input: string | Buffer): Promise<WordDocument>;
  }
}
