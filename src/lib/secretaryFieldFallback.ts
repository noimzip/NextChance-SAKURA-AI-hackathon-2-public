import type { RepeatWeekday, ScheduleRecurrenceInput, SecretaryAction } from "@/types";

interface ExtractedFields {
  tags?: string[];
  location?: string;
  items?: string;
  participants?: string;
  url?: string;
  notes?: string;
  isAllDay?: boolean;
  recurrence?: ScheduleRecurrenceInput | null;
}

const WEEKDAY_MAP: Record<string, RepeatWeekday> = {
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6,
};

function toHalfWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

function parsePositiveInteger(value: string): number | undefined {
  const normalized = toHalfWidthDigits(value);
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function extractRepeatCount(text: string): number | undefined {
  const direct = text.match(/(?:全\s*)?([0-9０-９]+)\s*回/u);
  if (direct?.[1]) {
    return parsePositiveInteger(direct[1]);
  }
  return undefined;
}

function extractWeekdays(text: string): RepeatWeekday[] {
  if (/(毎日)/u.test(text)) {
    return [0, 1, 2, 3, 4, 5, 6];
  }

  const weekdays = new Set<RepeatWeekday>();
  if (/平日/u.test(text)) {
    [1, 2, 3, 4, 5].forEach((weekday) => weekdays.add(weekday as RepeatWeekday));
  }
  if (/(週末|土日)/u.test(text)) {
    weekdays.add(0);
    weekdays.add(6);
  }

  for (const match of text.matchAll(/([日月火水木金土])(?:曜日|曜)/gu)) {
    const mapped = WEEKDAY_MAP[match[1]];
    if (mapped !== undefined) {
      weekdays.add(mapped);
    }
  }

  if (weekdays.size === 0 && /(毎週|繰り返し|曜日)/u.test(text)) {
    for (const segment of text.matchAll(/[日月火水木金土]{2,7}/gu)) {
      for (const token of segment[0]) {
        const mapped = WEEKDAY_MAP[token];
        if (mapped !== undefined) {
          weekdays.add(mapped);
        }
      }
    }
  }

  return [...weekdays].sort((a, b) => a - b);
}

function extractRecurrence(text: string): ScheduleRecurrenceInput | null | undefined {
  if (/(繰り返し(?:設定)?(?:の)?(?:を|は)?\s*(?:なし|不要|しない|オフ|解除))/u.test(text)) {
    return null;
  }

  const weekdays = extractWeekdays(text);
  const count = extractRepeatCount(text);
  if (weekdays.length === 0 || !count || count <= 1) {
    return undefined;
  }

  return {
    weekdays,
    count,
  };
}

function extractTags(text: string): string[] {
  const tags = new Set<string>();
  if (/(会議|打ち合わせ|ミーティング)/u.test(text)) tags.add("会議");
  if (/(提出|レポート|締切|期限)/u.test(text)) tags.add("締切");
  if (/(買い物|購入)/u.test(text)) tags.add("買い物");
  if (/(重要|急ぎ|至急|優先)/u.test(text)) tags.add("重要");
  if (/(病院|通院|診察)/u.test(text)) tags.add("健康");
  if (/(勉強|学習|試験|課題)/u.test(text)) tags.add("学習");
  if (/(旅行|出張|移動)/u.test(text)) tags.add("移動");
  return [...tags];
}

function cleanValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .trim()
    .replace(/^["'「『]/, "")
    .replace(/["'」』]$/, "")
    .replace(/[。．、,\s]+$/u, "");
  return cleaned || undefined;
}

function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s。．、,，)）\]}>"'`]+/i);
  return cleanValue(match?.[0]);
}

function extractLocation(text: string): string | undefined {
  if (/(zoom|google\s*meet|meet|teams|オンライン|online)/i.test(text)) {
    return "オンライン";
  }

  const explicitMatch = text.match(
    /(?:場所|会場|ロケーション)\s*(?:は|:|：)?\s*([^\n。！!？?、,]+)/u,
  );
  if (explicitMatch?.[1]) {
    return cleanValue(explicitMatch[1]);
  }

  const placeLikeMatch = text.match(
    /([^\s、。,.!?！？]{1,20}(?:会議室|オフィス|支社|本社|駅|空港|ホテル|カフェ|自宅|学校|病院))/u,
  );
  return cleanValue(placeLikeMatch?.[1]);
}

function extractItems(text: string): string | undefined {
  const explicitMatch = text.match(
    /(?:持ち物|持参(?:物)?|必要(?:な)?もの)\s*(?:は|:|：)?\s*([^\n。！!？?]+)/u,
  );
  if (explicitMatch?.[1]) {
    return cleanValue(explicitMatch[1]);
  }

  const carryMatch = text.match(/([^\n。！!？?]{1,30})を(?:持っていく|持参|準備)/u);
  return cleanValue(carryMatch?.[1]);
}

function extractParticipants(text: string): string | undefined {
  const explicitMatch = text.match(/(?:参加者|相手)\s*(?:は|:|：)?\s*([^\n。！!？?、,，]+)/u);
  if (explicitMatch?.[1]) {
    return cleanValue(explicitMatch[1]);
  }

  const withMatch = text.match(/([^\s、。,.!?！？]{1,20}(?:さん|氏|先生))(?:と|との)/u);
  return cleanValue(withMatch?.[1]);
}

function extractNotes(text: string): string | undefined {
  const explicitMatch = text.match(/(?:備考|メモ|補足|注記|注意)\s*(?:は|:|：)?\s*([^\n。]+)/u);
  if (explicitMatch?.[1]) {
    return cleanValue(explicitMatch[1]);
  }

  const hintMatch = text.match(
    /(遅刻厳禁|[0-9０-９]+分前(?:到着|集合)|忘れずに[^\n。！!？?]*|雨天時[^\n。！!？?]*)/u,
  );
  return cleanValue(hintMatch?.[1]);
}

function extractIsAllDay(text: string): boolean | undefined {
  if (/(終日|1日中|一日中|all[- ]?day)/iu.test(text)) {
    return true;
  }
  return undefined;
}

export function extractScheduleFieldsFromText(text: string): ExtractedFields {
  const inferredTags = extractTags(text);
  return {
    tags: inferredTags.length > 0 ? inferredTags : undefined,
    location: extractLocation(text),
    items: extractItems(text),
    participants: extractParticipants(text),
    url: extractUrl(text),
    notes: extractNotes(text),
    isAllDay: extractIsAllDay(text),
    recurrence: extractRecurrence(text),
  };
}

export function fillMissingActionFields(
  actions: SecretaryAction[],
  userText: string,
): SecretaryAction[] {
  const extracted = extractScheduleFieldsFromText(userText);

  return actions.map((action) => {
    if (action.type === "add_schedule") {
      return {
        ...action,
        payload: {
          ...action.payload,
          tags:
            action.payload.tags && action.payload.tags.length > 0
              ? action.payload.tags
              : extracted.tags,
          location: action.payload.location ?? extracted.location,
          items: action.payload.items ?? extracted.items,
          participants: action.payload.participants ?? extracted.participants,
          url: action.payload.url ?? extracted.url,
          notes: action.payload.notes ?? extracted.notes,
          isAllDay: action.payload.isAllDay ?? extracted.isAllDay,
          recurrence:
            action.payload.recurrence ??
            (extracted.recurrence && extracted.recurrence !== null
              ? extracted.recurrence
              : undefined),
        },
      };
    }

    if (action.type === "update_schedule") {
      return {
        ...action,
        payload: {
          ...action.payload,
          updates: {
            ...action.payload.updates,
            tags:
              action.payload.updates.tags && action.payload.updates.tags.length > 0
                ? action.payload.updates.tags
                : extracted.tags,
            location: action.payload.updates.location ?? extracted.location,
            items: action.payload.updates.items ?? extracted.items,
            participants: action.payload.updates.participants ?? extracted.participants,
            url: action.payload.updates.url ?? extracted.url,
            notes: action.payload.updates.notes ?? extracted.notes,
            isAllDay: action.payload.updates.isAllDay ?? extracted.isAllDay,
            recurrence:
              action.payload.updates.recurrence ??
              (extracted.recurrence !== undefined ? extracted.recurrence : undefined),
          },
        },
      };
    }

    return action;
  });
}
