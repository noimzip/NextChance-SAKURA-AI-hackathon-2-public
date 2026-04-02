import { useCallback, useEffect, useMemo, useState } from "react";
import { analyzeTimeTreeScreenshot } from "@/lib/sakura-ai-client";
import { cn } from "@/lib/utils";
import { DEFAULT_COLORS } from "@/hooks/useTags";
import { ImageUpload } from "@/components/photo-checker/ImageUpload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import type { ScheduleItem, Tag } from "@/types";

interface AddTagInput extends Omit<
  Tag,
  "id" | "createdAt" | "priority" | "conflictWarningsEnabled"
> {
  priority?: Tag["priority"];
  conflictWarningsEnabled?: boolean;
}

interface AddScheduleInput extends Omit<ScheduleItem, "id" | "completed" | "createdAt"> {}

interface ScreenshotImporterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedules: ScheduleItem[];
  tags: Tag[];
  addTag: (tag: AddTagInput) => Tag;
  addSchedule: (item: AddScheduleInput, options?: { idSeed?: number }) => void;
  onImported?: (count: number) => void;
}

interface ImportDraftRow {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  tagName: string;
  color: string;
  include: boolean;
}

interface RowScheduleRange {
  dueDate: Date;
  endDate: Date;
  isAllDay: boolean;
}

interface ConflictInfo {
  hasConflict: boolean;
  scheduleTitles: string[];
}

function normalizeColorInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^[a-zA-Z]+$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return null;
}

function normalizeDateInput(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return trimmed;
}

function normalizeTimeInput(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseRowScheduleRange(row: ImportDraftRow): RowScheduleRange | { error: string } {
  if (!row.title.trim()) {
    return { error: "タイトルを入力してください。" };
  }
  const date = normalizeDateInput(row.date);
  if (!date) {
    return { error: "日付を YYYY-MM-DD 形式で入力してください。" };
  }

  if (row.isAllDay) {
    const dueDate = new Date(`${date}T00:00:00`);
    const endDate = new Date(`${date}T23:59:59.999`);
    return { dueDate, endDate, isAllDay: true };
  }

  const startTime = normalizeTimeInput(row.startTime);
  if (!startTime) {
    return { error: "開始時刻を HH:mm 形式で入力してください。" };
  }
  const endTime = normalizeTimeInput(row.endTime);
  if (!endTime) {
    return { error: "終了時刻を HH:mm 形式で入力してください。" };
  }

  const dueDate = new Date(`${date}T${startTime}:00`);
  const endDate = new Date(`${date}T${endTime}:00`);
  if (endDate.getTime() <= dueDate.getTime()) {
    return { error: "終了時刻は開始時刻より後にしてください。" };
  }

  return { dueDate, endDate, isAllDay: false };
}

function createRowId(index: number): string {
  return `import-row-${Date.now()}-${index}`;
}

function findConflictingSchedules(row: ImportDraftRow, schedules: ScheduleItem[]): string[] {
  const range = parseRowScheduleRange(row);
  if (!("dueDate" in range)) {
    return [];
  }

  const targetTitle = row.title.trim();
  const targetDue = range.dueDate.getTime();
  const targetEnd = range.endDate.getTime();

  return schedules
    .filter((schedule) => {
      if (schedule.mode !== "schedule") {
        return false;
      }
      const sameTitle = schedule.title.trim() === targetTitle;
      const sameDue = new Date(schedule.dueDate).getTime() === targetDue;
      const sameEnd =
        (schedule.endDate ? new Date(schedule.endDate).getTime() : targetDue) === targetEnd;
      return sameTitle && sameDue && sameEnd;
    })
    .map((schedule) => schedule.title);
}

export function ScreenshotImporter({
  open,
  onOpenChange,
  schedules,
  tags,
  addTag,
  addSchedule,
  onImported,
}: ScreenshotImporterProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [yearMonth, setYearMonth] = useState<string>("");
  const [rows, setRows] = useState<ImportDraftRow[]>([]);

  const revokePreviewIfBlob = useCallback((url: string | null) => {
    if (url?.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }, []);

  const resetState = useCallback(() => {
    revokePreviewIfBlob(selectedImage);
    setSelectedImage(null);
    setSelectedFile(null);
    setIsAnalyzing(false);
    setAnalysisError(null);
    setImportError(null);
    setYearMonth("");
    setRows([]);
  }, [revokePreviewIfBlob, selectedImage]);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  useEffect(() => {
    return () => {
      revokePreviewIfBlob(selectedImage);
    };
  }, [revokePreviewIfBlob, selectedImage]);

  const conflictByRowId = useMemo(() => {
    const map = new Map<string, ConflictInfo>();
    for (const row of rows) {
      const scheduleTitles = findConflictingSchedules(row, schedules);
      map.set(row.id, {
        hasConflict: scheduleTitles.length > 0,
        scheduleTitles,
      });
    }
    return map;
  }, [rows, schedules]);

  const rowIssuesById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const issues: string[] = [];
      const color = normalizeColorInput(row.color);
      if (!color) {
        issues.push("色は #RRGGBB または色名で入力してください。");
      }
      const range = parseRowScheduleRange(row);
      if (!("dueDate" in range)) {
        issues.push(range.error);
      }
      map.set(row.id, issues);
    }
    return map;
  }, [rows]);

  const selectedRows = useMemo(() => rows.filter((row) => row.include), [rows]);
  const rowsWithErrors = useMemo(
    () => selectedRows.filter((row) => (rowIssuesById.get(row.id)?.length ?? 0) > 0),
    [rowIssuesById, selectedRows],
  );

  const updateRow = useCallback(
    (rowId: string, updates: Partial<ImportDraftRow>) => {
      setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...updates } : row)));
    },
    [setRows],
  );

  const handleImageSelect = useCallback(
    (file: File, previewUrl: string) => {
      revokePreviewIfBlob(selectedImage);
      setSelectedImage(previewUrl);
      setSelectedFile(file);
      setAnalysisError(null);
      setImportError(null);
      setRows([]);
      setYearMonth("");
    },
    [revokePreviewIfBlob, selectedImage],
  );

  const handleClearImage = useCallback(() => {
    revokePreviewIfBlob(selectedImage);
    setSelectedImage(null);
    setSelectedFile(null);
    setRows([]);
    setYearMonth("");
    setAnalysisError(null);
    setImportError(null);
  }, [revokePreviewIfBlob, selectedImage]);

  const handleAnalyze = async () => {
    if (!selectedFile) {
      setAnalysisError("解析するスクリーンショット画像を選択してください。");
      return;
    }

    setAnalysisError(null);
    setImportError(null);
    setIsAnalyzing(true);
    try {
      const parsed = await analyzeTimeTreeScreenshot(selectedFile);
      if (parsed.events.length === 0) {
        throw new Error("スクリーンショットから予定を抽出できませんでした。");
      }

      const draftRows: ImportDraftRow[] = parsed.events.map((event, index) => {
        const existingTag = event.tag ? tags.find((tag) => tag.name === event.tag) : undefined;
        const normalizedColor =
          normalizeColorInput(event.color ?? "") ?? existingTag?.color ?? DEFAULT_COLORS[0];
        const row: ImportDraftRow = {
          id: createRowId(index),
          title: event.title,
          date: event.date ?? "",
          startTime: event.start_time ?? "",
          endTime: event.end_time ?? "",
          isAllDay: event.is_all_day === true,
          tagName: event.tag ?? "",
          color: normalizedColor,
          include: true,
        };
        const hasConflict = findConflictingSchedules(row, schedules).length > 0;
        return {
          ...row,
          include: hasConflict ? false : true,
        };
      });

      setYearMonth(parsed.year_month);
      setRows(draftRows);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "スクリーンショット解析に失敗しました。時間をおいて再試行してください。";
      setAnalysisError(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImport = () => {
    setImportError(null);

    if (selectedRows.length === 0) {
      setImportError("取り込む予定を1件以上選択してください。");
      return;
    }
    if (rowsWithErrors.length > 0) {
      setImportError("入力不備のある行があります。修正してから取り込みを実行してください。");
      return;
    }

    const resolvedTagsByName = new Map(tags.map((tag) => [tag.name, tag]));
    let importedCount = 0;

    for (const row of selectedRows) {
      const range = parseRowScheduleRange(row);
      if (!("dueDate" in range)) {
        continue;
      }
      const normalizedColor = normalizeColorInput(row.color);
      const normalizedTagName = row.tagName.trim();

      const scheduleTags: Tag[] = [];
      if (normalizedTagName) {
        let tag = resolvedTagsByName.get(normalizedTagName);
        if (!tag) {
          tag = addTag({
            name: normalizedTagName,
            color: normalizedColor ?? DEFAULT_COLORS[0],
            priority: normalizedTagName === "重要" ? "high" : "medium",
            conflictWarningsEnabled: true,
          });
          resolvedTagsByName.set(normalizedTagName, tag);
        }
        scheduleTags.push(tag);
      }

      addSchedule({
        title: row.title.trim(),
        mode: "schedule",
        dueDate: range.dueDate,
        endDate: range.endDate,
        isAllDay: range.isAllDay,
        tags: scheduleTags,
        color: normalizedColor ?? undefined,
      });
      importedCount += 1;
    }

    if (importedCount === 0) {
      setImportError("取り込める予定がありません。");
      return;
    }

    onImported?.(importedCount);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            TimeTreeスクリーンショット取込
          </DialogTitle>
          <DialogDescription>
            画像を解析して予定を抽出します。保存前にタイトル・日時・タグ・カラーを確認/修正できます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">1. スクリーンショットをアップロード</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ImageUpload
                onImageSelect={handleImageSelect}
                selectedImage={selectedImage}
                onClear={handleClearImage}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  解析モデル: preview/Qwen3-VL-30B-A3B-Instruct
                </p>
                <Button onClick={handleAnalyze} disabled={!selectedFile || isAnalyzing}>
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      解析中...
                    </>
                  ) : (
                    "スクリーンショットを解析"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {analysisError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {analysisError}
            </div>
          )}

          {rows.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">
                    2. 抽出結果を確認して取り込み（対象月: {yearMonth}）
                  </CardTitle>
                  <Badge variant="outline">{rows.length}件抽出</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {rows.map((row, index) => {
                  const conflicts = conflictByRowId.get(row.id);
                  const issues = rowIssuesById.get(row.id) ?? [];
                  const includeInputId = `import-row-include-${row.id}`;
                  return (
                    <Card
                      key={row.id}
                      className={cn(
                        "border",
                        conflicts?.hasConflict && "border-amber-400 bg-amber-50/30",
                        row.include &&
                          issues.length > 0 &&
                          "border-destructive/60 bg-destructive/5",
                      )}
                    >
                      <CardHeader className="pb-2 pt-4 px-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={includeInputId}
                              checked={row.include}
                              onCheckedChange={(checked) =>
                                updateRow(row.id, { include: checked === true })
                              }
                            />
                            <Label htmlFor={includeInputId}>行{index + 1}を取り込む</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            {conflicts?.hasConflict ? (
                              <Badge className="bg-amber-600 text-white">重複候補</Badge>
                            ) : (
                              <Badge variant="secondary">新規</Badge>
                            )}
                            {row.include && issues.length > 0 && (
                              <Badge variant="destructive">要修正</Badge>
                            )}
                          </div>
                        </div>
                        {conflicts?.hasConflict && (
                          <p className="text-xs text-amber-700">
                            既存予定と重複: {conflicts.scheduleTitles.join(" / ")}
                          </p>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-3 px-4 pb-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">予定タイトル</Label>
                            <Input
                              value={row.title}
                              onChange={(event) => updateRow(row.id, { title: event.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">日付</Label>
                            <Input
                              type="date"
                              value={row.date}
                              onChange={(event) => updateRow(row.id, { date: event.target.value })}
                            />
                          </div>
                          <div className="flex items-center gap-2 pt-2">
                            <Checkbox
                              id={`import-all-day-${row.id}`}
                              checked={row.isAllDay}
                              onCheckedChange={(checked) =>
                                updateRow(row.id, { isAllDay: checked === true })
                              }
                            />
                            <Label htmlFor={`import-all-day-${row.id}`}>終日予定</Label>
                          </div>
                          <div />
                          {!row.isAllDay && (
                            <>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">開始時刻</Label>
                                <Input
                                  type="time"
                                  value={row.startTime}
                                  onChange={(event) =>
                                    updateRow(row.id, { startTime: event.target.value })
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">終了時刻</Label>
                                <Input
                                  type="time"
                                  value={row.endTime}
                                  onChange={(event) =>
                                    updateRow(row.id, { endTime: event.target.value })
                                  }
                                />
                              </div>
                            </>
                          )}
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">タグ</Label>
                            <Input
                              value={row.tagName}
                              placeholder="例: 習い事"
                              onChange={(event) =>
                                updateRow(row.id, { tagName: event.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              色（#RRGGBB または色名）
                            </Label>
                            <div className="flex items-center gap-2">
                              <Input
                                value={row.color}
                                onChange={(event) =>
                                  updateRow(row.id, { color: event.target.value })
                                }
                              />
                              <span
                                className="h-6 w-6 rounded border"
                                style={{
                                  backgroundColor: normalizeColorInput(row.color) ?? "transparent",
                                }}
                                aria-hidden="true"
                              />
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {DEFAULT_COLORS.map((color) => (
                                <button
                                  key={`${row.id}-${color}`}
                                  type="button"
                                  className="h-5 w-5 rounded border"
                                  style={{ backgroundColor: color }}
                                  onClick={() => updateRow(row.id, { color })}
                                  aria-label={`${color}を選択`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        {row.include && issues.length > 0 && (
                          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                            <p className="text-xs font-medium text-destructive mb-1 flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              この行は修正が必要です
                            </p>
                            <ul className="text-xs text-destructive space-y-0.5">
                              {issues.map((issue) => (
                                <li key={`${row.id}-${issue}`}>• {issue}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {importError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {importError}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground">
            取り込み対象: {selectedRows.length}件 / 要修正: {rowsWithErrors.length}件
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleImport} disabled={rows.length === 0 || isAnalyzing}>
            {selectedRows.length}件を取り込む
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
