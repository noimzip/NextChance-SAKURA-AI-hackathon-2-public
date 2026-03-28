const DEFAULT_MIN_CHARS = 120;
const DEFAULT_MAX_CHARS = 180;
const DEFAULT_FALLBACK_RESPONSE = "状況は把握したのだ。優先順位を整理して次の一歩を進めるのだ。";

const TONE_PATTERN = /(?:のだ|なのだ)(?=[。!！?？\s]|$)/;
const MARKDOWN_TABLE_PATTERN = /[|｜│].+[|｜│]\s*\n[|｜│][\s:：\-－ー]+[|｜│]/;
const PIPE_TABLE_LINE_PATTERN = /[|｜│].+[|｜│]/;

function normalizeResponseText(text: string): string {
  return text
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMarkdownTable(text: string): boolean {
  if (MARKDOWN_TABLE_PATTERN.test(text)) {
    return true;
  }

  const lines = text.split("\n");
  let consecutivePipeRows = 0;
  for (const line of lines) {
    if (PIPE_TABLE_LINE_PATTERN.test(line.trim())) {
      consecutivePipeRows += 1;
      if (consecutivePipeRows >= 2) {
        return true;
      }
      continue;
    }
    consecutivePipeRows = 0;
  }

  return false;
}

function hasZundamonTone(text: string): boolean {
  return TONE_PATTERN.test(text);
}

function ensureSentenceEnding(text: string): string {
  if (!text) return text;
  return /[。!！?？]$/.test(text) ? text : `${text}。`;
}

function trimToMax(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const hardTrimmed = text.slice(0, maxChars);
  const punctuationIndex = Math.max(
    hardTrimmed.lastIndexOf("。"),
    hardTrimmed.lastIndexOf("！"),
    hardTrimmed.lastIndexOf("？"),
    hardTrimmed.lastIndexOf("!"),
    hardTrimmed.lastIndexOf("?"),
  );

  if (punctuationIndex >= Math.floor(maxChars * 0.6)) {
    return hardTrimmed.slice(0, punctuationIndex + 1);
  }

  return `${hardTrimmed.slice(0, Math.max(0, maxChars - 1))}…`;
}

function enforceZundamonTone(text: string, maxChars: number): string {
  if (hasZundamonTone(text)) {
    return text;
  }

  const toneSuffix = "この調子で進めるのだ。";
  const withEnding = ensureSentenceEnding(text);

  if (withEnding.length + 1 + toneSuffix.length <= maxChars) {
    return `${withEnding} ${toneSuffix}`;
  }

  if (maxChars <= toneSuffix.length) {
    return toneSuffix.slice(0, maxChars);
  }

  return `${withEnding.slice(0, maxChars - toneSuffix.length)}${toneSuffix}`;
}

interface FormatSecretaryResponseOptions {
  minChars?: number;
  maxChars?: number;
  fallback?: string;
}

export function formatSecretaryResponse(
  content: string,
  options: FormatSecretaryResponseOptions = {},
): string {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const fallback = options.fallback ?? DEFAULT_FALLBACK_RESPONSE;

  const normalizedLineBreaks = content.replace(/\r\n?/g, "\n").trim();
  if (hasMarkdownTable(normalizedLineBreaks)) {
    return normalizedLineBreaks;
  }

  let formatted = normalizeResponseText(normalizedLineBreaks);
  if (!formatted) {
    formatted = fallback;
  }

  if (formatted.length < minChars) {
    const supplement = " 優先順位を明確にして一緒に着実に進めるのだ。";
    if (formatted.length + supplement.length <= maxChars) {
      formatted = `${ensureSentenceEnding(formatted)}${supplement}`;
    }
  }

  formatted = enforceZundamonTone(formatted, maxChars);
  formatted = trimToMax(formatted, maxChars);
  formatted = enforceZundamonTone(formatted, maxChars);

  return formatted.trim();
}
