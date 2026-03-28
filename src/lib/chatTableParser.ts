export interface ParsedChatTable {
  headers: string[];
  rows: string[][];
  source: "markdown" | "tsv" | "csv";
}

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "table"; table: ParsedChatTable };

interface ParsedTableResult {
  table: ParsedChatTable;
  nextIndex: number;
}

const FULLWIDTH_PIPE_PATTERN = /[｜│]/g;

function normalizePipeCharacters(value: string): string {
  return value.replace(FULLWIDTH_PIPE_PATTERN, "|");
}

function normalizeCell(value: string): string {
  return value.trim();
}

function parsePipeRow(line: string): string[] | null {
  const trimmed = normalizePipeCharacters(line).trim();
  if (!trimmed.includes("|")) return null;

  let normalized = trimmed;
  if (normalized.startsWith("|")) normalized = normalized.slice(1);
  if (normalized.endsWith("|")) normalized = normalized.slice(0, -1);

  const cells = normalized.split("|").map((cell) => normalizeCell(cell));
  if (cells.length < 2) return null;
  if (cells.every((cell) => cell.length === 0)) return null;

  return cells;
}

function isMarkdownSeparatorLine(line: string): boolean {
  const trimmed = normalizePipeCharacters(line).trim();
  if (!trimmed.includes("-")) return false;
  if (!trimmed.includes("|")) return false;

  let normalized = trimmed;
  if (normalized.startsWith("|")) normalized = normalized.slice(1);
  if (normalized.endsWith("|")) normalized = normalized.slice(0, -1);

  const segments = normalized.split("|").map((segment) => segment.trim());
  if (segments.length < 2) return false;

  return segments.every((segment) => /^:?-{3,}:?$/.test(segment));
}

function normalizeRowLength(row: string[], expectedLength: number): string[] {
  if (row.length === expectedLength) return row;
  if (row.length < expectedLength) {
    return [...row, ...Array(expectedLength - row.length).fill("")];
  }
  return row.slice(0, expectedLength);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(normalizeCell(current));
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(normalizeCell(current));
  return cells;
}

function parseDelimitedLine(line: string, delimiter: "\t" | ","): string[] {
  if (delimiter === "\t") {
    return line.split("\t").map((cell) => normalizeCell(cell));
  }

  return parseCsvLine(line);
}

function parseMarkdownTable(lines: string[], startIndex: number): ParsedTableResult | null {
  if (startIndex + 2 >= lines.length) return null;

  const headers = parsePipeRow(lines[startIndex]);
  if (!headers) return null;
  if (!isMarkdownSeparatorLine(lines[startIndex + 1])) return null;

  const rawRows: string[][] = [];
  let cursor = startIndex + 2;

  while (cursor < lines.length) {
    const currentLine = lines[cursor];
    if (currentLine.trim().length === 0) break;

    const row = parsePipeRow(currentLine);
    if (!row) break;
    if (isMarkdownSeparatorLine(currentLine)) {
      cursor += 1;
      continue;
    }

    rawRows.push(row);
    cursor += 1;
  }

  if (rawRows.length === 0) return null;

  const rows = rawRows.map((row) => normalizeRowLength(row, headers.length));
  return {
    table: {
      headers,
      rows,
      source: "markdown",
    },
    nextIndex: cursor,
  };
}

function parsePipeTableWithoutSeparator(
  lines: string[],
  startIndex: number,
): ParsedTableResult | null {
  if (startIndex + 1 >= lines.length) return null;

  const headers = parsePipeRow(lines[startIndex]);
  if (!headers) return null;

  const secondLine = lines[startIndex + 1];
  if (isMarkdownSeparatorLine(secondLine)) return null;

  const firstDataRow = parsePipeRow(secondLine);
  if (!firstDataRow) return null;

  const rawRows: string[][] = [firstDataRow];
  let cursor = startIndex + 2;

  while (cursor < lines.length) {
    const currentLine = lines[cursor];
    if (currentLine.trim().length === 0) break;

    if (isMarkdownSeparatorLine(currentLine)) {
      cursor += 1;
      continue;
    }

    const row = parsePipeRow(currentLine);
    if (!row) break;
    rawRows.push(row);
    cursor += 1;
  }

  if (rawRows.length === 0) return null;

  const rows = rawRows.map((row) => normalizeRowLength(row, headers.length));
  return {
    table: {
      headers,
      rows,
      source: "markdown",
    },
    nextIndex: cursor,
  };
}

function parseDelimitedTable(
  lines: string[],
  startIndex: number,
  delimiter: "\t" | ",",
): ParsedTableResult | null {
  const minColumns = delimiter === "," ? 3 : 2;
  const parsedRows: string[][] = [];
  let cursor = startIndex;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim().length === 0) break;
    if (!line.includes(delimiter)) break;

    const cells = parseDelimitedLine(line, delimiter);
    if (cells.length < minColumns) break;

    parsedRows.push(cells);
    cursor += 1;
  }

  if (parsedRows.length < 2) return null;

  const headers = parsedRows[0];
  const rows = parsedRows.slice(1).map((row) => normalizeRowLength(row, headers.length));

  return {
    table: {
      headers,
      rows,
      source: delimiter === "\t" ? "tsv" : "csv",
    },
    nextIndex: cursor,
  };
}

function normalizeInlineMarkdownTable(content: string): string {
  if (content.includes("\n")) return content;
  const normalizedPipes = normalizePipeCharacters(content);
  if (!normalizedPipes.includes("|") || !normalizedPipes.includes("-")) return content;

  return normalizedPipes.replace(/\s\|\s\|/g, " |\n|");
}

function flushTextBlock(buffer: string[], output: ChatContentBlock[]): void {
  if (buffer.length === 0) return;
  const text = buffer.join("\n");
  if (text.trim().length === 0) {
    buffer.length = 0;
    return;
  }
  output.push({ type: "text", text });
  buffer.length = 0;
}

export function splitChatContentBlocks(content: string): ChatContentBlock[] {
  const normalized = normalizeInlineMarkdownTable(content.replace(/\r\n?/g, "\n"));
  const lines = normalized.split("\n");
  const blocks: ChatContentBlock[] = [];
  const textBuffer: string[] = [];
  let inCodeFence = false;

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      textBuffer.push(line);
      index += 1;
      continue;
    }

    if (inCodeFence) {
      textBuffer.push(line);
      index += 1;
      continue;
    }

    const markdownTable = parseMarkdownTable(lines, index);
    if (markdownTable) {
      flushTextBlock(textBuffer, blocks);
      blocks.push({ type: "table", table: markdownTable.table });
      index = markdownTable.nextIndex;
      continue;
    }

    const pipeTableWithoutSeparator = parsePipeTableWithoutSeparator(lines, index);
    if (pipeTableWithoutSeparator) {
      flushTextBlock(textBuffer, blocks);
      blocks.push({ type: "table", table: pipeTableWithoutSeparator.table });
      index = pipeTableWithoutSeparator.nextIndex;
      continue;
    }

    const tsvTable = parseDelimitedTable(lines, index, "\t");
    if (tsvTable) {
      flushTextBlock(textBuffer, blocks);
      blocks.push({ type: "table", table: tsvTable.table });
      index = tsvTable.nextIndex;
      continue;
    }

    const csvTable = parseDelimitedTable(lines, index, ",");
    if (csvTable) {
      flushTextBlock(textBuffer, blocks);
      blocks.push({ type: "table", table: csvTable.table });
      index = csvTable.nextIndex;
      continue;
    }

    textBuffer.push(line);
    index += 1;
  }

  flushTextBlock(textBuffer, blocks);

  return blocks.length > 0 ? blocks : [{ type: "text", text: content }];
}
