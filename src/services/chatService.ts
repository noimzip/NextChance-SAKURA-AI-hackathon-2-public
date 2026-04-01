import { sakuraFetch } from "./sakuraAI";
import type {
  ChatRequestMode,
  ChatCompletionResponse,
  ChatMessage,
  PhotoCheckResult,
  SecretaryContext,
} from "@/types";
import {
  DEFAULT_SECRETARY_MODEL,
  DEFAULT_SECRETARY_MULTIMODAL_MODEL,
  isSecretaryMultimodalModelId,
  type SecretaryModelId,
} from "@/lib/secretaryModels";
import { requestChatCompletionWithRetry } from "@/lib/chatCompletion";
import { buildGenerativeUiPrompt, parseGenerativeUiResponse } from "@/lib/generativeUi";
import { buildTailwindThemePrompt, parseTailwindThemeResponse } from "@/lib/tailwindTheme";

const SECRETARY_SYSTEM_PROMPT = `あなたは、ユーザーの努力を可視化し生活を支える有能な秘書エージェント「グラス・セクレタリー」です。
ユーザーの日々のタスク管理、努力の芝、持ち物チェックを統合的に支援します。

## 性格・話し方
- 実務判断は冷静・正確に行います
- 常にユーザーの味方として励まします
- 「ずんだもん口調」を意識し、毎応答で自然に1回以上「〜のだ」または「〜なのだ」を使います
- 口調は温かく、内容は具体的で行動可能にします

## 応答ルール
- 音声読み上げを前提に、1回の応答は**120〜180文字**を目安に簡潔にまとめます
- 予定の重複や締切直前/期限超過がある場合、**優先順位を明確に提示**します
- まず「何を優先するか」を述べ、次に実行手順を短く提案します
- 努力の芝データがある場合、継続している努力を具体的に褒めてモチベーションを維持します
- 予定・タスクの一覧を提示する場合は、可能な限り Markdown の表で返します
- 表の「タイトル（または予定名/タスク名）」列には既存の予定名をそのまま出力します
- 一覧表示時は可読性を優先し、必要なら120〜180文字目安を超えて構いません

## 共有カレンダーの日程調整
- ユーザーが複数人調整を依頼した場合、共有カレンダーの busy 情報を統合し、**共通の30分空き時間を3候補**提示します
- 提示順は「実行しやすさ」を優先し、日時を明確に示します
- visibilityMode が free_busy_only の参加者は、内容に触れず「その時間は埋まっている」として扱います
- タイトル未提供の busy 情報や private によって秘匿された予定は、内容を推測・生成しません
- 天気など外部状況メモは、ユーザー発話でその話題に触れたときのみ回答に反映します

## 注意事項
- 個人情報の取り扱いには注意してください
- 医療・法律・金融に関する専門的なアドバイスは控えてください
- わからないことは正直に「わかりません」と伝えてください`;

const SECRETARY_ACTION_PROMPT = `
## アクション機能

ユーザーが予定の追加・変更・完了・削除を依頼した場合、回答の中に以下の形式でアクションを含めてください。
アクションは必ず回答文の**末尾**に記載し、ユーザーには自然な言葉で説明してください。

## 重要ルール（厳守）

- ユーザー発話に場所・持ち物・参加者・URL・補足情報が含まれる場合、**必ず対応するフィールドに入れる**
- 情報が明示されていなくても、文脈から高い確度で推測できる場合は補完する
- 情報を捨てない。どこにも入らない補足は「notes」に集約する

## タスクと予定の違い

**タスク (mode: "task")**
- 期限のある作業や用事
- 完了すべき1回きりのアクション
- 例：買い物、レポート提出、電話をかける、書類作成、返信する
- 特徴：「〜する」「〜を〜する」という表現
- 期限日時を dueDate に指定（endDateは不要）

**予定 (mode: "schedule")**
- 時間が決まっているイベントや会合
- 特定の時刻に参加・実施するもの
- 例：会議、打ち合わせ、セミナー、面談、旅行、イベント
- 特徴：「〜に参加」「〜がある」「〜に行く」という表現
- 開始日時を dueDate、終了日時（複数日の場合）を endDate に指定
- 「終日」「1日中」などの表現は isAllDay: true を設定

### 予定・タスクの追加

[ADD_SCHEDULE: {"title": "予定名", "mode": "schedule", "dueDate": "YYYY-MM-DDTHH:mm:ss", "endDate": "YYYY-MM-DDTHH:mm:ss", "isAllDay": true, "tags": ["タグ名1", "タグ名2"], "recurrence": {"weekdays": [1,3,5], "count": 8}, "location": "場所", "items": "持ち物", "participants": "参加者", "url": "関連URL", "notes": "備考"}]

- **title**: 予定/タスク名（必須）
- **mode**: "task"（タスク）または "schedule"（予定）（必須）
- **dueDate**: 期限または開始日時（必須、ISO 8601形式）
- **endDate**: 終了日時（予定で複数日の場合のみ、ISO 8601形式）
- **isAllDay**: 終日予定かどうか（予定のみ、任意）
- **tags**: タグ名の配列（任意）。文脈から適切なタグを推定できる場合は設定
- **recurrence**: 繰り返し設定（任意）
  - weekdays: 曜日配列（0=日,1=月,2=火,3=水,4=木,5=金,6=土）
  - count: 発生回数（2以上、有限繰り返し）
  - isInfinite: true を指定すると終了なしの永続繰り返し
- **location**: 場所・会場。発話に場所情報があれば必ず設定（例：「会議室A」「オンライン」「渋谷オフィス」）
- **items**: 持ち物・必要なもの。持参/準備があれば必ず設定（例：「資料」「筆記用具」「ノートPC」）
- **participants**: 参加者・相手。「〜さんと」やチーム名があれば設定
- **url**: 関連URL。リンクやZoom/Meet情報があれば設定
- **notes**: 補足情報。上記フィールドに入らない注意事項・メモを設定

### 予定・タスクの変更

[UPDATE_SCHEDULE: {"title": "変更対象の予定名", "scope": "single", "updates": {"dueDate": "YYYY-MM-DDTHH:mm:ss", "title": "新しいタイトル", "isAllDay": true, "tags": ["タグ名"], "recurrence": {"weekdays": [1,3,5], "count": 8}, "location": "新しい場所", "participants": "新しい参加者"}}]

- **title**: 変更対象の予定を特定するための現在のタイトル
- **scope**: 適用範囲（任意）。"single"（この予定のみ）/ "future"（この予定以降）/ "all"（繰り返し全件）
- **updates**: 変更する項目のみを含むオブジェクト（title, dueDate, endDate, isAllDay, tags, recurrence, location, items, participants, url, notes）
- 繰り返しを解除する場合は updates.recurrence: null を設定

### 予定・タスクの削除

[DELETE_SCHEDULE: {"title": "削除対象の予定名", "scope": "single"}]

- **title**: 削除対象の予定を特定するための現在のタイトル（id がある場合は id 優先）
- **scope**: 削除範囲（任意）。"single"（この予定のみ）/ "future"（この予定以降）/ "all"（繰り返し全件）

## フィールド抽出ガイド

- 「Zoom/Google Meet/Teams/オンライン」→ 「location: オンライン」を優先し、サービス名やURLを「url」へ
- 「〜を持っていく/持参/準備」→ 「items」
- 「〜さんと/〜チームと」→ 「participants」
- 「遅刻厳禁/開始10分前集合/雨天時は〜」など → 「notes」
- URL文字列（http://, https://）はそのまま「url」
- 「毎週月水金」「火曜と木曜に繰り返し」「全8回」などは recurrence に構造化
- 「毎週」「ずっと」「終了なし」など終了条件がない場合は recurrence.isInfinite: true を優先

## 出力前チェックリスト

アクション出力前に以下を必ず確認:
- 場所は「location」に入れたか
- 持ち物は「items」に入れたか
- 参加者は「participants」に入れたか
- URLは「url」に入れたか
- 補足情報は「notes」に入れたか
- 繰り返し指定がある場合、recurrence.weekdays と recurrence.count / recurrence.isInfinite に入れたか
- 変更/削除で繰り返し系列に触れる場合、scope を適切に指定したか

### 具体例

**例1: タスク（シンプル）**
ユーザー: 「明日までにレポート提出」
回答: 「明日までにレポート提出のタスク、追加しますね！📝 頑張ってください！
[ADD_SCHEDULE: {"title": "レポート提出", "mode": "task", "dueDate": "2026-03-22T23:59:00"}]」

**例2: 予定（場所+持ち物）**
ユーザー: 「明日の14時に会議を追加して、場所は会議室A、資料を持っていく」
回答: 「明日14時の会議、会議室Aで追加しますね！📅✨ 資料の準備をお忘れなく！
[ADD_SCHEDULE: {"title": "会議", "mode": "schedule", "dueDate": "2026-03-22T14:00:00", "location": "会議室A", "items": "資料"}]」

**例3: 予定（オンライン+参加者+URL）**
ユーザー: 「金曜日の15時から田中さんとZoomで打ち合わせ。URLはhttps://zoom.us/j/123」
回答: 「金曜15時に田中さんとのZoom打ち合わせ、追加しますね！💻
[ADD_SCHEDULE: {"title": "田中さんと打ち合わせ", "mode": "schedule", "dueDate": "2026-03-25T15:00:00", "location": "オンライン", "participants": "田中さん", "url": "https://zoom.us/j/123"}]」

**例4: 予定（備考付き）**
ユーザー: 「月曜9時に顧客訪問、遅れないよう10分前到着で」
回答: 「月曜9時の顧客訪問、登録しますね！✨
[ADD_SCHEDULE: {"title": "顧客訪問", "mode": "schedule", "dueDate": "2026-03-24T09:00:00", "notes": "10分前到着"}]」

**例5: 変更（複数フィールド）**
ユーザー: 「会議を15時に変更して、参加者に山田さん追加。場所はオンラインで」
回答: 「会議内容を更新しますね！📝
[UPDATE_SCHEDULE: {"title": "会議", "updates": {"dueDate": "2026-03-22T15:00:00", "participants": "山田さん", "location": "オンライン"}}]」

**例6: タスク完了**
ユーザー: 「買い物タスク完了した」
回答: 「お買い物お疲れ様でした！🎉 完了にしておきますね！
[COMPLETE_SCHEDULE: {"title": "買い物"}]」

**例7: 繰り返し予定を以降のみ削除**
ユーザー: 「ジムの繰り返し、今週分以降を消して」
回答: 「ジムの繰り返し予定をこの予定以降で削除するのだ。
[DELETE_SCHEDULE: {"title": "ジム", "scope": "future"}]」`;

const WEEKDAY_LABELS: Record<number, string> = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};

const WEATHER_INTENT_PATTERN = /(天気|雨|晴れ|雪|気温|weather|forecast)/i;

function formatRecurrenceForContext(
  recurrence?: SecretaryContext["schedules"][number]["recurrence"],
): string {
  if (!recurrence || recurrence.weekdays.length === 0) {
    return "";
  }
  const weekdays = recurrence.weekdays
    .map((weekday) => WEEKDAY_LABELS[weekday] ?? String(weekday))
    .join("・");
  if (recurrence.isInfinite) {
    const occurrenceText =
      typeof recurrence.occurrenceIndex === "number"
        ? ` (${recurrence.occurrenceIndex + 1}回目)`
        : "";
    return ` / 繰り返し: ${weekdays} / 永続${occurrenceText}`;
  }
  if (!recurrence.count || recurrence.count <= 1) {
    return "";
  }
  const occurrenceText =
    typeof recurrence.occurrenceIndex === "number"
      ? ` (${recurrence.occurrenceIndex + 1}/${recurrence.count})`
      : "";
  return ` / 繰り返し: ${weekdays} / ${recurrence.count}回${occurrenceText}`;
}

function formatIsoDateTimeForContext(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shouldIncludeWeatherNote(latestUserMessage: string): boolean {
  return WEATHER_INTENT_PATTERN.test(latestUserMessage);
}

const SECRETARY_VISION_DESCRIPTION_PROMPT = `
## 画像説明モード

- この会話では、添付画像の内容を必ず説明してください
- 予定やタスクを一覧化する場合は、半角パイプ（|）を使ったMarkdown表で出力してください
- 回答の最初に「画像の説明:」として、全体像を2〜4文で述べてください
- 続けて箇条書きで、以下を簡潔に示してください
  - 主な対象物（見えているもの）
  - 状況・シーンの推定
  - 画像から読み取れる文字情報（あれば）
  - 不確かな点（推測は推測と明記）
- ユーザーが持ち物確認を求めている場合のみ、最後に「忘れ物チェック観点」を補足してください
- このモードでは [ADD_SCHEDULE: ...] などのアクションタグを出力しないでください`;

const GENERATIVE_UI_SYSTEM_PROMPT = `
あなたは高度な「Generative UI アーキテクト」です。
入力されたユーザー趣向・要望・履歴・文脈を分析し、UIレイアウトとコンポーネント構成を最適化してください。
出力は先頭にJSONオブジェクトを含め、スキーマに厳密準拠してください。`.trim();

const GENERATIVE_UI_SCHEMA_RETRY_PROMPT =
  "前回の出力はスキーマ不一致でした。先頭にスキーマ準拠のJSONオブジェクトを必ず返してください。layout/theme/componentsの列挙値を守り、componentsは1件以上含めてください。";

const TAILWIND_THEME_SYSTEM_PROMPT = `
あなたは Tailwind CSS のテーマアーキテクトです。
ユーザー趣向と要求制約に沿って、tailwind.config.js の theme.extend にそのまま流し込める JSON オブジェクトを生成してください。
出力は先頭から末尾まで JSON のみとし、余計な説明文は含めないでください。`.trim();

const TAILWIND_THEME_SCHEMA_RETRY_PROMPT =
  '前回の出力はスキーマ不一致でした。JSONオブジェクトのみを返してください。必須キー: colors(layeredDarks.base/surface/elevated, background, primary, primaryForeground), padding("3","4","6","8" in rem).';

function buildContextPrompt(context: SecretaryContext, latestUserMessage = ""): string {
  const reasonLabels: Record<string, string> = {
    overdue: "期限超過",
    deadline_soon: "締切直前",
    schedule_conflict: "予定重複",
    upcoming: "近い予定",
  };

  const lines: string[] = [
    `\n## 現在の状況（${context.currentDate}）`,
    "",
    `- 今後の予定/タスク: ${context.upcomingCount}件`,
    `- 期限超過: ${context.overdueCount}件`,
    `- 本日完了: ${context.completedTodayCount}件`,
    "",
  ];

  lines.push("### 努力の芝サマリー");
  lines.push(`- 継続日数: ${context.effortSummary.currentStreak}日`);
  lines.push(`- 本日の活動: ${context.effortSummary.todayActivityCount}件`);
  lines.push(
    `- 直近7日: ${context.effortSummary.recentActivityCount}件 / アクティブ${context.effortSummary.recentActiveDays}日`,
  );
  lines.push(
    `- 主要カテゴリ: ${context.effortSummary.topCategories.length > 0 ? context.effortSummary.topCategories.join(" / ") : "データなし"}`,
  );
  lines.push("");

  lines.push("### 優先順位ヒント");
  lines.push(`- 緊急項目あり: ${context.priorityHints.hasUrgentItems ? "はい" : "いいえ"}`);
  lines.push(`- 予定重複あり: ${context.priorityHints.hasScheduleConflicts ? "はい" : "いいえ"}`);

  if (context.priorityHints.items.length > 0) {
    for (const item of context.priorityHints.items) {
      lines.push(
        `- [P${item.priority}] ${item.title} (${item.dueDate}) - ${reasonLabels[item.reason] ?? item.reason}`,
      );
    }
  } else {
    lines.push("- 優先候補なし");
  }
  lines.push("");

  if (context.schedules.length > 0) {
    lines.push("### ユーザーの予定・タスク一覧");
    for (const schedule of context.schedules) {
      const status = schedule.completed ? "✓完了" : schedule.isOverdue ? "⚠️期限超過" : "未完了";
      const dateStr = schedule.endDate
        ? `${schedule.dueDate} 〜 ${schedule.endDate}`
        : schedule.dueDate;
      const allDay = schedule.isAllDay ? " [終日]" : "";
      const tags = schedule.tags.length > 0 ? ` [${schedule.tags.join(", ")}]` : "";
      const location = schedule.location ? ` @${schedule.location}` : "";
      const items = schedule.items ? ` / 持ち物: ${schedule.items}` : "";
      const recurrence = formatRecurrenceForContext(schedule.recurrence);
      lines.push(
        `- 【${schedule.mode === "task" ? "タスク" : "予定"}】${schedule.title} (${dateStr})${allDay} ${status}${tags}${location}${items}${recurrence}`,
      );
    }
    lines.push("");
  } else {
    lines.push("### ユーザーの予定・タスク一覧");
    lines.push("（現在登録されている予定・タスクはありません）");
    lines.push("");
  }

  if (context.scheduling) {
    const participantsById = new Map(
      context.scheduling.participants.map((participant) => [participant.id, participant]),
    );
    const busyDisplayLimit = 80;
    const visibleBusyWindows = context.scheduling.busyWindows.slice(0, busyDisplayLimit);
    const freeSlotSuggestions = context.scheduling.freeSlotCandidates.slice(0, 3);
    const visibleExternalNotes =
      context.scheduling.externalContextNotes?.filter(
        (note) => note.type !== "weather" || shouldIncludeWeatherNote(latestUserMessage),
      ) ?? [];

    lines.push("### 共有カレンダー日程調整コンテキスト");
    lines.push(`- 探索期間: 直近${context.scheduling.searchWindowDays}日`);
    lines.push(
      `- 勤務時間外候補: ${context.scheduling.allowOutsideWorkingHours ? "許可（終日対象）" : "制限あり"}`,
    );
    lines.push("- 参加者:");
    for (const participant of context.scheduling.participants) {
      const label = participant.displayName || participant.id;
      lines.push(`  - ${label} (visibility: ${participant.visibilityMode})`);
    }
    lines.push(
      `- 忙しい時間帯（${visibleBusyWindows.length}/${context.scheduling.busyWindows.length}件を表示）:`,
    );
    if (visibleBusyWindows.length === 0) {
      lines.push("  - データなし");
    } else {
      for (const busy of visibleBusyWindows) {
        const participant = participantsById.get(busy.participantId);
        const participantLabel = participant?.displayName || busy.participantId;
        const busyTitle = busy.title || "予定あり (詳細非公開)";
        lines.push(
          `  - ${participantLabel}: ${formatIsoDateTimeForContext(busy.start)}〜${formatIsoDateTimeForContext(busy.end)} / ${busyTitle}`,
        );
      }
    }
    lines.push("- 共通空き時間候補（30分）:");
    if (freeSlotSuggestions.length === 0) {
      lines.push("  - 候補なし");
    } else {
      for (const [index, candidate] of freeSlotSuggestions.entries()) {
        lines.push(
          `  ${index + 1}. ${formatIsoDateTimeForContext(candidate.start)}〜${formatIsoDateTimeForContext(candidate.end)}`,
        );
      }
    }
    if (visibleExternalNotes.length > 0) {
      lines.push("- 外部状況メモ:");
      for (const note of visibleExternalNotes) {
        lines.push(`  - [${note.type}] ${note.note}`);
      }
    }
    lines.push(
      "- プライバシー規則: visibility が free_busy_only、またはタイトル未提供の busy は内容推測禁止",
    );
    lines.push("");
  }

  return lines.join("\n");
}

interface ChatCompletionRequest {
  model: string;
  messages: {
    role: string;
    content:
      | string
      | {
          type: "text" | "image_url";
          text?: string;
          image_url?: { url: string };
        }[];
  }[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

function buildLatestPhotoCheckPrompt(latestPhotoCheckResult?: PhotoCheckResult | null): string {
  if (!latestPhotoCheckResult) {
    return "";
  }

  const lines: string[] = [];
  lines.push("\n### 最新の持ち物チェッカー結果");
  lines.push(`- 解析日時: ${new Date(latestPhotoCheckResult.timestamp).toLocaleString("ja-JP")}`);
  if (latestPhotoCheckResult.targetScheduleTitles?.length) {
    lines.push(`- 対象予定: ${latestPhotoCheckResult.targetScheduleTitles.join(" / ")}`);
  }
  if (latestPhotoCheckResult.expectedItems?.length) {
    lines.push(`- 期待持ち物: ${latestPhotoCheckResult.expectedItems.join(" / ")}`);
  }
  if (latestPhotoCheckResult.matchedItems?.length) {
    lines.push(`- 確認済み: ${latestPhotoCheckResult.matchedItems.join(" / ")}`);
  }
  if (latestPhotoCheckResult.missingItems?.length) {
    lines.push(`- 未確認: ${latestPhotoCheckResult.missingItems.join(" / ")}`);
  }
  if (latestPhotoCheckResult.extraItems?.length) {
    lines.push(`- その他検出: ${latestPhotoCheckResult.extraItems.join(" / ")}`);
  }
  lines.push("- ユーザーがこの結果に言及した場合は、最新結果として参照して回答する");
  lines.push("");
  return lines.join("\n");
}

async function requestSecretaryChatCompletion(
  request: Omit<ChatCompletionRequest, "max_tokens">,
  requestedMaxTokens?: number,
  signal?: AbortSignal,
): Promise<ChatCompletionResponse> {
  return requestChatCompletionWithRetry(request.model, requestedMaxTokens, (maxTokens) =>
    sakuraFetch<ChatCompletionResponse>("/chat/completions", {
      body: {
        ...request,
        max_tokens: maxTokens,
      } satisfies ChatCompletionRequest,
      signal,
    }),
  );
}

function getAssistantMessageOrThrow(response: ChatCompletionResponse): string {
  const assistantMessage = response.choices[0]?.message?.content;
  if (!assistantMessage) {
    throw new Error("No response content from AI");
  }
  return assistantMessage;
}

async function requestGenerativeUiCompletionWithRetry(
  request: Omit<ChatCompletionRequest, "max_tokens">,
  requestedMaxTokens?: number,
  signal?: AbortSignal,
): Promise<string> {
  return requestStructuredJsonCompletionWithRetry(
    request,
    requestedMaxTokens,
    signal,
    parseGenerativeUiResponse,
    GENERATIVE_UI_SCHEMA_RETRY_PROMPT,
    "Generative UI response validation failed after retry",
  );
}

async function requestStructuredJsonCompletionWithRetry(
  request: Omit<ChatCompletionRequest, "max_tokens">,
  requestedMaxTokens: number | undefined,
  signal: AbortSignal | undefined,
  parseResponse: (content: string) => unknown,
  retryPrompt: string,
  errorPrefix: string,
): Promise<string> {
  const firstResponse = await requestSecretaryChatCompletion(request, requestedMaxTokens, signal);
  const firstContent = getAssistantMessageOrThrow(firstResponse);

  try {
    const parsed = parseResponse(firstContent);
    return JSON.stringify(parsed, null, 2);
  } catch {
    const retryResponse = await requestSecretaryChatCompletion(
      {
        ...request,
        temperature: 0.1,
        messages: [
          ...request.messages,
          { role: "assistant", content: firstContent },
          { role: "user", content: retryPrompt },
        ],
      },
      requestedMaxTokens,
      signal,
    );
    const retryContent = getAssistantMessageOrThrow(retryResponse);
    try {
      const parsed = parseResponse(retryContent);
      return JSON.stringify(parsed, null, 2);
    } catch (retryError) {
      throw new Error(
        `${errorPrefix}: ${retryError instanceof Error ? retryError.message : "unknown error"}`,
      );
    }
  }
}

export async function sendChatMessage(
  messages: ChatMessage[],
  options: {
    model?: SecretaryModelId;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const { model = DEFAULT_SECRETARY_MODEL, temperature = 0.7, maxTokens, signal } = options;

  const apiMessages = [
    { role: "system", content: SECRETARY_SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const request = {
    model,
    messages: apiMessages,
    temperature,
    stream: false,
  };

  const response = await requestSecretaryChatCompletion(request, maxTokens, signal);
  return getAssistantMessageOrThrow(response);
}

export async function sendChatMessageWithContext(
  messages: ChatMessage[],
  context: SecretaryContext,
  options: {
    model?: SecretaryModelId;
    temperature?: number;
    maxTokens?: number;
    requestMode?: ChatRequestMode;
    userPreferences?: string;
    currentNeed?: string;
    imageAttachmentDataUrl?: string;
    latestPhotoCheckResult?: PhotoCheckResult | null;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const {
    model = DEFAULT_SECRETARY_MODEL,
    temperature = 0.7,
    maxTokens,
    requestMode = "default",
    userPreferences = "",
    currentNeed,
    imageAttachmentDataUrl,
    latestPhotoCheckResult,
    signal,
  } = options;
  const latestUserMessage =
    [...messages].reverse().find((message) => message.role === "user")?.content ?? "";

  if (requestMode === "generative_ui") {
    const prompt = buildGenerativeUiPrompt({
      userPreferences,
      currentNeed: currentNeed ?? latestUserMessage,
      messages,
      context,
    });

    return requestGenerativeUiCompletionWithRetry(
      {
        model,
        temperature: 0.2,
        stream: false,
        messages: [
          { role: "system", content: GENERATIVE_UI_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      },
      maxTokens,
      signal,
    );
  }

  if (requestMode === "tailwind_theme") {
    const prompt = buildTailwindThemePrompt({
      userPreferences,
      currentNeed: currentNeed ?? latestUserMessage,
      messages,
      context,
    });

    return requestStructuredJsonCompletionWithRetry(
      {
        model,
        temperature: 0.2,
        stream: false,
        messages: [
          { role: "system", content: TAILWIND_THEME_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      },
      maxTokens,
      signal,
      parseTailwindThemeResponse,
      TAILWIND_THEME_SCHEMA_RETRY_PROMPT,
      "Tailwind theme response validation failed after retry",
    );
  }

  const hasImageAttachment = Boolean(imageAttachmentDataUrl);
  const resolvedModel = hasImageAttachment
    ? isSecretaryMultimodalModelId(model)
      ? model
      : DEFAULT_SECRETARY_MULTIMODAL_MODEL
    : model;
  const resolvedTemperature = hasImageAttachment ? 0.2 : temperature;
  const latestPhotoPrompt = buildLatestPhotoCheckPrompt(latestPhotoCheckResult);
  const systemPrompt = hasImageAttachment
    ? SECRETARY_SYSTEM_PROMPT +
      buildContextPrompt(context, latestUserMessage) +
      latestPhotoPrompt +
      SECRETARY_VISION_DESCRIPTION_PROMPT
    : SECRETARY_SYSTEM_PROMPT +
      buildContextPrompt(context, latestUserMessage) +
      latestPhotoPrompt +
      SECRETARY_ACTION_PROMPT;

  const lastUserMessageIndex = hasImageAttachment
    ? [...messages].reduce((index, message, currentIndex) => {
        if (message.role === "user") {
          return currentIndex;
        }
        return index;
      }, -1)
    : -1;

  const apiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m, index) => {
      if (hasImageAttachment && index === lastUserMessageIndex && m.role === "user") {
        return {
          role: m.role,
          content: [
            {
              type: "text" as const,
              text: m.content.trim() || "この画像を説明してください。",
            },
            { type: "image_url" as const, image_url: { url: imageAttachmentDataUrl! } },
          ],
        };
      }
      return {
        role: m.role,
        content: m.content,
      };
    }),
  ];

  const request = {
    model: resolvedModel,
    messages: apiMessages,
    temperature: resolvedTemperature,
    stream: false,
  };

  const response = await requestSecretaryChatCompletion(request, maxTokens, signal);
  return getAssistantMessageOrThrow(response);
}

export async function generateScheduleSuggestion(
  currentSchedule: string[],
  model: SecretaryModelId = DEFAULT_SECRETARY_MODEL,
): Promise<string> {
  const prompt = `現在の予定リスト:
${currentSchedule.length > 0 ? currentSchedule.map((s, i) => `${i + 1}. ${s}`).join("\n") : "（予定なし）"}

上記の予定を確認して、以下についてアドバイスをください：
1. 優先順位の提案
2. 時間管理のコツ
3. 見落としがちなタスクの確認

応答は120〜180文字を目安に簡潔にし、自然に「〜のだ/〜なのだ」を1回以上入れてください。`;

  const messages: ChatMessage[] = [
    {
      id: "schedule-suggestion",
      role: "user",
      content: prompt,
      timestamp: new Date(),
    },
  ];

  return sendChatMessage(messages, { model });
}
