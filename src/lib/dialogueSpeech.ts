import { splitChatContentBlocks } from "@/lib/chatTableParser";
import { getTitleColumnIndex, isLikelyScheduleTable } from "@/lib/scheduleTable";

function normalizeValue(value: string): string {
  return value.trim();
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toScheduleRowSpeech(
  headers: string[],
  row: string[],
  titleColumnIndex: number,
  rowIndex: number,
): string | null {
  const title = normalizeValue(row[titleColumnIndex] ?? "");
  if (!title) return null;

  const detailSegments = row
    .map((cell, index) => ({
      cell: normalizeValue(cell),
      header: normalizeValue(headers[index] ?? ""),
      index,
    }))
    .filter((segment) => segment.index !== titleColumnIndex && segment.cell.length > 0)
    .map((segment) => (segment.header ? `${segment.header}は${segment.cell}` : segment.cell));

  if (detailSegments.length === 0) {
    return `${rowIndex + 1}件目は${title}`;
  }

  return `${rowIndex + 1}件目は${title}。${detailSegments.join("。")}`;
}

export function formatDialogueSpeechText(content: string): string {
  const blocks = splitChatContentBlocks(content);
  const segments: string[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      const text = normalizeLine(block.text);
      if (text.length > 0) {
        segments.push(text);
      }
      continue;
    }

    if (!isLikelyScheduleTable(block.table.headers)) {
      continue;
    }

    const titleColumnIndex = getTitleColumnIndex(block.table.headers);
    if (titleColumnIndex < 0) {
      continue;
    }

    const rowSegments = block.table.rows
      .map((row, rowIndex) =>
        toScheduleRowSpeech(block.table.headers, row, titleColumnIndex, rowIndex),
      )
      .filter((value): value is string => Boolean(value));

    if (rowSegments.length > 0) {
      segments.push(rowSegments.join("。"));
    }
  }

  const merged = normalizeLine(segments.join("。"));
  if (!merged) {
    return normalizeLine(content);
  }

  return merged;
}
