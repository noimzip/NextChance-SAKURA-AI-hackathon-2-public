const TITLE_HEADER_CANDIDATES = ["タイトル", "予定名", "タスク名", "名前", "件名", "name", "title"];
const SCHEDULE_CONTEXT_KEYWORDS = [
  "期限",
  "日時",
  "日付",
  "状態",
  "優先",
  "種別",
  "タグ",
  "deadline",
  "status",
  "date",
];

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

export function isLikelyScheduleTable(headers: string[]): boolean {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const hasTitleColumn = normalizedHeaders.some((header) =>
    TITLE_HEADER_CANDIDATES.some((candidate) => header.includes(candidate.toLowerCase())),
  );
  const hasScheduleContextColumn = normalizedHeaders.some((header) =>
    SCHEDULE_CONTEXT_KEYWORDS.some((keyword) => header.includes(keyword)),
  );

  return hasTitleColumn && hasScheduleContextColumn;
}

export function getTitleColumnIndex(headers: string[]): number {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));

  for (const candidate of TITLE_HEADER_CANDIDATES) {
    const index = normalizedHeaders.findIndex((header) => header.includes(candidate.toLowerCase()));
    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

export const __internal__ = {
  TITLE_HEADER_CANDIDATES,
  SCHEDULE_CONTEXT_KEYWORDS,
};
