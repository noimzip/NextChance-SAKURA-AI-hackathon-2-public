import type { BelongingsComparisonPolicy, BelongingsItemSuggestion, ScheduleItem } from "@/types";

const ITEM_SPLIT_PATTERN = /[\n、,，;；・/／|｜]/g;

const NORMAL_ALIAS_GROUPS = [
  ["パソコン", "pc", "ノートpc", "ノートパソコン", "ラップトップ"],
  ["スマホ", "スマートフォン", "iphone", "android"],
  ["財布", "さいふ", "ウォレット"],
  ["イヤホン", "ヘッドホン", "earphone", "headphone"],
  ["充電器", "チャージャー", "acアダプタ", "acアダプター", "ケーブル"],
  ["社員証", "idカード", "id", "身分証", "学生証"],
  ["定期券", "交通系ic", "suica", "pasmo", "icカード"],
  ["水筒", "ボトル", "マイボトル"],
  ["傘", "折りたたみ傘", "折り畳み傘"],
];

function toAsciiDigits(text: string): string {
  return text.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function canonicalizeByPolicy(raw: string, policy: BelongingsComparisonPolicy): string {
  const normalized = toAsciiDigits(raw).normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim();

  if (policy === "strict") {
    return normalized;
  }

  const aliasGroups = policy === "lenient" ? [...NORMAL_ALIAS_GROUPS] : NORMAL_ALIAS_GROUPS;
  const matchedGroup = aliasGroups.find((group) => group.includes(normalized));
  if (matchedGroup) {
    return matchedGroup[0];
  }

  if (policy === "lenient") {
    return normalized.replace(/の|を|と|用|向け/g, "").replace(/持参|準備|一式/g, "");
  }

  return normalized;
}

function uniqueByCanonical(
  values: string[],
  policy: BelongingsComparisonPolicy,
): { canonicalToOriginal: Map<string, string>; canonicalList: string[] } {
  const canonicalToOriginal = new Map<string, string>();

  for (const value of values) {
    const canonical = canonicalizeByPolicy(value, policy);
    if (!canonical) continue;
    if (!canonicalToOriginal.has(canonical)) {
      canonicalToOriginal.set(canonical, value.trim());
    }
  }

  return {
    canonicalToOriginal,
    canonicalList: [...canonicalToOriginal.keys()],
  };
}

export function parseItemsTextToList(itemsText?: string): string[] {
  if (!itemsText) return [];
  return itemsText
    .split(ITEM_SPLIT_PATTERN)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function collectExpectedItemsFromSchedules(schedules: ScheduleItem[]): string[] {
  return schedules.flatMap((schedule) => parseItemsTextToList(schedule.items));
}

export function mergeBelongingsItems(items: string[]): string[] {
  const unique = uniqueByCanonical(items, "normal");
  return unique.canonicalList.map((key) => unique.canonicalToOriginal.get(key) ?? key);
}

interface SuggestBelongingsFromHistoryInput {
  targetSchedules: ScheduleItem[];
  historySchedules: ScheduleItem[];
  maxSuggestions?: number;
}

function normalizeTextForToken(value?: string): string[] {
  if (!value) return [];
  return value
    .normalize("NFKC")
    .toLowerCase()
    .split(/[\s、,，;；・/／|｜()（）[\]{}「」『』:：]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function toSet(values: string[]): Set<string> {
  return new Set(values);
}

function countIntersection(a: Set<string>, b: Set<string>): number {
  let hit = 0;
  for (const value of a) {
    if (b.has(value)) {
      hit += 1;
    }
  }
  return hit;
}

function recencyScore(dueDate: Date): number {
  const diffDays = Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 30) return 1;
  if (diffDays <= 90) return 0.7;
  if (diffDays <= 180) return 0.45;
  if (diffDays <= 365) return 0.25;
  return 0.1;
}

function computeScheduleSimilarity(target: ScheduleItem, candidate: ScheduleItem): number {
  const targetTitleTokens = toSet(normalizeTextForToken(target.title));
  const candidateTitleTokens = toSet(normalizeTextForToken(candidate.title));
  const titleHit = countIntersection(targetTitleTokens, candidateTitleTokens);
  const titleScore = titleHit > 0 ? Math.min(1, titleHit / Math.max(1, targetTitleTokens.size)) : 0;

  const targetTagTokens = toSet(target.tags.map((tag) => tag.name.toLowerCase()));
  const candidateTagTokens = toSet(candidate.tags.map((tag) => tag.name.toLowerCase()));
  const tagHit = countIntersection(targetTagTokens, candidateTagTokens);
  const tagScore = tagHit > 0 ? Math.min(1, tagHit / Math.max(1, targetTagTokens.size)) : 0;

  const locationMatch =
    target.location && candidate.location && target.location.trim() === candidate.location.trim()
      ? 1
      : 0;

  const modeScore = target.mode === candidate.mode ? 0.4 : 0;
  const freshScore = recencyScore(new Date(candidate.dueDate));

  const weighted = titleScore * 0.45 + tagScore * 0.25 + locationMatch * 0.15 + modeScore * 0.05;
  return Math.min(1, weighted + freshScore * 0.1);
}

export function suggestBelongingsFromHistory(
  input: SuggestBelongingsFromHistoryInput,
): BelongingsItemSuggestion[] {
  const { targetSchedules, historySchedules, maxSuggestions = 8 } = input;
  if (targetSchedules.length === 0 || historySchedules.length === 0 || maxSuggestions <= 0) {
    return [];
  }

  const existingExpectedItems = collectExpectedItemsFromSchedules(targetSchedules);
  const existingCanonical = uniqueByCanonical(existingExpectedItems, "normal").canonicalList;
  const existingSet = new Set(existingCanonical);

  const targetIds = new Set(targetSchedules.map((schedule) => schedule.id));
  const now = Date.now();
  const relevantHistory = historySchedules.filter(
    (schedule) =>
      !targetIds.has(schedule.id) &&
      new Date(schedule.dueDate).getTime() <= now &&
      parseItemsTextToList(schedule.items).length > 0,
  );

  const itemCandidates = new Map<
    string,
    { item: string; score: number; sourceScheduleTitles: Set<string> }
  >();

  for (const target of targetSchedules) {
    for (const candidate of relevantHistory) {
      const similarity = computeScheduleSimilarity(target, candidate);
      if (similarity < 0.2) {
        continue;
      }

      const candidateItems = parseItemsTextToList(candidate.items);
      for (const rawItem of candidateItems) {
        const canonical = canonicalizeByPolicy(rawItem, "normal");
        if (!canonical || existingSet.has(canonical)) {
          continue;
        }
        const previous = itemCandidates.get(canonical);
        if (!previous) {
          itemCandidates.set(canonical, {
            item: rawItem,
            score: similarity,
            sourceScheduleTitles: new Set([candidate.title]),
          });
          continue;
        }
        previous.score = Math.max(previous.score, similarity);
        previous.sourceScheduleTitles.add(candidate.title);
      }
    }
  }

  return [...itemCandidates.values()]
    .sort((a, b) => b.score - a.score || a.item.localeCompare(b.item, "ja"))
    .slice(0, maxSuggestions)
    .map((entry) => ({
      item: entry.item,
      score: Number(entry.score.toFixed(3)),
      sourceScheduleTitles: [...entry.sourceScheduleTitles].slice(0, 3),
    }));
}

export function compareBelongings(
  expectedItems: string[],
  detectedItems: string[],
  policy: BelongingsComparisonPolicy = "normal",
): {
  expected: string[];
  matched: string[];
  missing: string[];
  extra: string[];
} {
  const expectedUnique = uniqueByCanonical(expectedItems, policy);
  const detectedUnique = uniqueByCanonical(detectedItems, policy);
  const detectedSet = new Set(detectedUnique.canonicalList);

  const matchedCanonical = expectedUnique.canonicalList.filter((item) => detectedSet.has(item));
  const missingCanonical = expectedUnique.canonicalList.filter((item) => !detectedSet.has(item));
  const expectedSet = new Set(expectedUnique.canonicalList);
  const extraCanonical = detectedUnique.canonicalList.filter((item) => !expectedSet.has(item));

  return {
    expected: expectedUnique.canonicalList.map(
      (key) => expectedUnique.canonicalToOriginal.get(key) ?? key,
    ),
    matched: matchedCanonical.map((key) => expectedUnique.canonicalToOriginal.get(key) ?? key),
    missing: missingCanonical.map((key) => expectedUnique.canonicalToOriginal.get(key) ?? key),
    extra: extraCanonical.map((key) => detectedUnique.canonicalToOriginal.get(key) ?? key),
  };
}

export function getSchedulesByCheckMode(
  schedules: ScheduleItem[],
  mode: "single_schedule" | "today_bundle" | "next_24h_bundle",
  selectedScheduleId?: string | null,
): ScheduleItem[] {
  if (mode === "single_schedule") {
    if (!selectedScheduleId) return [];
    const selected = schedules.find((schedule) => schedule.id === selectedScheduleId);
    return selected ? [selected] : [];
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return schedules.filter((schedule) => {
    if (schedule.completed) return false;
    const dueDate = new Date(schedule.dueDate);
    if (mode === "today_bundle") {
      return dueDate >= todayStart && dueDate <= todayEnd;
    }
    return dueDate >= now && dueDate <= next24h;
  });
}
