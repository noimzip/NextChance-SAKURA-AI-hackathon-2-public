import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ImageUpload } from "./ImageUpload";
import { CheckResult } from "./CheckResult";
import { useEffortLog } from "@/hooks/useEffortLog";
import {
  analyzePhotoWithQwenModel,
  loadPhotoCheckHistory,
  PHOTO_CHECKER_MODEL_ID,
  savePhotoCheckHistoryEntry,
  saveLatestPhotoCheckResult,
} from "@/services/photoAnalysisService";
import { useSchedule } from "@/hooks/useSchedule";
import {
  collectExpectedItemsFromSchedules,
  getSchedulesByCheckMode,
  mergeBelongingsItems,
  suggestBelongingsFromHistory,
} from "@/lib/belongings";
import {
  isSecretaryMultimodalModelId,
  SECRETARY_MODEL_OPTIONS,
  type SecretaryMultimodalModelId,
} from "@/lib/secretaryModels";
import { Camera, Loader2, Image as ImageIcon, Sparkles } from "lucide-react";
import type { BelongingsCheckMode, PhotoCheckResult } from "@/types";

interface PhotoCheckerProps {
  className?: string;
}

export function PhotoChecker({ className }: PhotoCheckerProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<PhotoCheckResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [historyPreviewImageUrl, setHistoryPreviewImageUrl] = useState<string | null>(null);
  const [historyPreviewImageName, setHistoryPreviewImageName] = useState<string | null>(null);
  const [checkMode, setCheckMode] = useState<BelongingsCheckMode>("single_schedule");
  const [includeSuggestedItems, setIncludeSuggestedItems] = useState(true);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");
  const [selectedModelId, setSelectedModelId] =
    useState<SecretaryMultimodalModelId>(PHOTO_CHECKER_MODEL_ID);
  const [history, setHistory] = useState<PhotoCheckResult[]>(() => loadPhotoCheckHistory());
  const { schedules } = useSchedule();
  const { addActivity } = useEffortLog();
  const multimodalModelOptions = useMemo(
    () => SECRETARY_MODEL_OPTIONS.filter((option) => isSecretaryMultimodalModelId(option.id)),
    [],
  );

  const candidateSchedules = useMemo(
    () => schedules.filter((schedule) => !schedule.completed),
    [schedules],
  );

  const revokeIfBlobUrl = useCallback((url: string | null) => {
    if (url?.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }, []);

  const targetSchedules = useMemo(
    () =>
      getSchedulesByCheckMode(
        candidateSchedules,
        checkMode,
        checkMode === "single_schedule" ? selectedScheduleId : null,
      ),
    [candidateSchedules, checkMode, selectedScheduleId],
  );

  const explicitExpectedItems = useMemo(
    () => collectExpectedItemsFromSchedules(targetSchedules),
    [targetSchedules],
  );

  const suggestedItems = useMemo(
    () =>
      suggestBelongingsFromHistory({
        targetSchedules,
        historySchedules: schedules,
        maxSuggestions: 8,
      }),
    [schedules, targetSchedules],
  );

  const appliedSuggestedItems = useMemo(
    () => (includeSuggestedItems ? suggestedItems.map((entry) => entry.item) : []),
    [includeSuggestedItems, suggestedItems],
  );

  const expectedItems = useMemo(
    () => mergeBelongingsItems([...explicitExpectedItems, ...appliedSuggestedItems]),
    [appliedSuggestedItems, explicitExpectedItems],
  );

  const handleImageSelect = useCallback(
    (file: File, previewUrl: string) => {
      revokeIfBlobUrl(selectedImage);
      setSelectedImage(previewUrl);
      setSelectedFile(file);
      setResult(null);
      setAnalysisError(null);
    },
    [revokeIfBlobUrl, selectedImage],
  );

  const handleClear = useCallback(() => {
    revokeIfBlobUrl(selectedImage);
    setSelectedImage(null);
    setSelectedFile(null);
    setResult(null);
    setAnalysisError(null);
  }, [revokeIfBlobUrl, selectedImage]);

  const handleAnalyze = async () => {
    if (!selectedImage || !selectedFile) {
      setAnalysisError("解析する画像を選択してください。");
      return;
    }
    if (checkMode === "single_schedule" && !selectedScheduleId) {
      setAnalysisError("照合対象の予定を選択してください。");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const analysisResult = await analyzePhotoWithQwenModel(selectedFile, {
        previewUrl: selectedImage,
        expectedItems,
        suggestedItems,
        appliedSuggestedItems,
        comparisonPolicy: "normal",
        checkMode,
        targetScheduleIds: targetSchedules.map((schedule) => schedule.id),
        targetScheduleTitles: targetSchedules.map((schedule) => schedule.title),
        modelId: selectedModelId,
      });
      setResult(analysisResult);
      saveLatestPhotoCheckResult(analysisResult);
      savePhotoCheckHistoryEntry(analysisResult);
      setHistory(loadPhotoCheckHistory());

      addActivity({
        type: "photo_check",
        description: "持ち物チェックを実行",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "画像解析に失敗しました。時間をおいて再試行してください。";
      setAnalysisError(message);
      console.error("Analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Card className={cn("flex flex-col h-full", className)}>
      <CardHeader className="flex-shrink-0 border-b bg-gradient-to-r from-blue-50/80 to-transparent">
        <CardTitle className="text-xl flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 text-white shadow-sm">
            <Camera className="h-4 w-4" />
          </div>
          <span className="bg-gradient-to-r from-blue-700 to-indigo-600 bg-clip-text text-transparent">
            持ち物チェッカー
          </span>
        </CardTitle>
        <CardDescription>カバンの中身を撮影して、忘れ物がないかAIがチェックします</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-4 overflow-auto pt-4">
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">画像認識モデル</p>
          <select
            value={selectedModelId}
            onChange={(event) => {
              const nextModelId = event.target.value;
              if (!isSecretaryMultimodalModelId(nextModelId)) {
                return;
              }
              setSelectedModelId(nextModelId);
              setResult(null);
            }}
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
          >
            {multimodalModelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          <p className="text-xs font-medium text-muted-foreground">照合モード</p>
          <select
            value={checkMode}
            onChange={(event) => {
              const next = event.target.value as BelongingsCheckMode;
              setCheckMode(next);
              if (next !== "single_schedule") {
                setSelectedScheduleId("");
              }
              setResult(null);
            }}
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="single_schedule">単一の予定で照合</option>
            <option value="today_bundle">当日の予定まとめて照合</option>
            <option value="next_24h_bundle">直近24時間の予定まとめて照合</option>
          </select>

          {checkMode === "single_schedule" && (
            <select
              value={selectedScheduleId}
              onChange={(event) => {
                setSelectedScheduleId(event.target.value);
                setResult(null);
              }}
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">予定を選択してください</option>
              {candidateSchedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.title}
                </option>
              ))}
            </select>
          )}

          <div className="text-xs text-muted-foreground">
            対象予定:{" "}
            {targetSchedules.length > 0
              ? targetSchedules.map((schedule) => schedule.title).join(" / ")
              : "なし"}
          </div>
          <div className="text-xs text-muted-foreground">
            登録持ち物:{" "}
            {explicitExpectedItems.length > 0 ? explicitExpectedItems.join(" / ") : "なし"}
          </div>
          {suggestedItems.length > 0 ? (
            <div className="rounded-md border border-blue-200 bg-blue-50/60 p-2 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                <p className="text-xs font-medium text-blue-700">過去予定からの提案持ち物</p>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="apply-suggested-items"
                  checked={includeSuggestedItems}
                  onCheckedChange={(checked) => {
                    setIncludeSuggestedItems(checked === true);
                    setResult(null);
                  }}
                />
                <Label htmlFor="apply-suggested-items" className="text-xs cursor-pointer">
                  提案持ち物を照合対象に含める
                </Label>
              </div>
              <div className="space-y-1">
                {suggestedItems.map((entry) => (
                  <div
                    key={`${entry.item}-${entry.sourceScheduleTitles.join("|")}`}
                    className="rounded border bg-background px-2 py-1.5"
                  >
                    <p className="text-xs font-medium text-foreground">{entry.item}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      参考: {entry.sourceScheduleTitles.join(" / ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="text-xs text-muted-foreground">
            照合対象: {expectedItems.length > 0 ? expectedItems.join(" / ") : "なし"}
          </div>
        </div>

        <ImageUpload
          onImageSelect={handleImageSelect}
          selectedImage={selectedImage}
          onClear={handleClear}
        />

        {selectedImage && !result && (
          <Button onClick={handleAnalyze} disabled={isAnalyzing} className="w-full">
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                解析中...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" />
                持ち物をチェック
              </>
            )}
          </Button>
        )}

        {analysisError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {analysisError}
          </div>
        )}

        {result && (
          <div className="p-4 border rounded-lg bg-muted/30">
            <CheckResult result={result} />
            <Button variant="outline" className="w-full mt-4" onClick={handleClear}>
              別の写真をチェック
            </Button>
          </div>
        )}

        {history.length > 0 && (
          <div className="rounded-lg border bg-background p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">チェック履歴（最新20件）</p>
            <div className="space-y-2">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setResult(entry)}
                  className="w-full rounded-md border p-2 text-left hover:bg-muted/60 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    {entry.imageUrl ? (
                      <img
                        src={entry.imageUrl}
                        alt="履歴画像"
                        className="h-12 w-12 rounded border object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded border bg-muted flex items-center justify-center shrink-0">
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString("ja-JP")}
                      </p>
                      {entry.targetScheduleTitles?.length ? (
                        <p className="text-xs text-foreground mt-1 truncate">
                          対象: {entry.targetScheduleTitles.join(" / ")}
                        </p>
                      ) : null}
                      <p className="text-xs text-amber-700 mt-1 truncate">
                        未確認:{" "}
                        {entry.missingItems.length > 0 ? entry.missingItems.join(" / ") : "なし"}
                      </p>
                      {entry.appliedSuggestedItems?.length ? (
                        <p className="text-xs text-blue-700 mt-1 truncate">
                          提案適用: {entry.appliedSuggestedItems.join(" / ")}
                        </p>
                      ) : null}
                    </div>
                    {entry.imageUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px] shrink-0"
                        onClick={(event) => {
                          event.stopPropagation();
                          setHistoryPreviewImageUrl(entry.imageUrl);
                          setHistoryPreviewImageName(
                            entry.targetScheduleTitles?.join(" / ") || "履歴画像",
                          );
                        }}
                      >
                        画像
                      </Button>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!selectedImage && (
          <div className="mt-4 p-4 bg-muted/30 rounded-lg">
            <h4 className="text-sm font-medium mb-2">💡 使い方のヒント</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• カバンの中身を広げて撮影すると精度が上がります</li>
              <li>• 明るい場所で撮影してください</li>
              <li>• 持ち物リストを事前に登録すると、チェック精度が向上します</li>
            </ul>
          </div>
        )}
      </CardContent>
      <Dialog
        open={Boolean(historyPreviewImageUrl)}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryPreviewImageUrl(null);
            setHistoryPreviewImageName(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl p-3">
          <DialogHeader>
            <DialogTitle>{historyPreviewImageName ?? "履歴画像"}</DialogTitle>
            <DialogDescription className="sr-only">
              忘れ物チェッカーの履歴画像を拡大表示しています。
            </DialogDescription>
          </DialogHeader>
          {historyPreviewImageUrl ? (
            <img
              src={historyPreviewImageUrl}
              alt={historyPreviewImageName ?? "履歴画像"}
              className="w-full max-h-[75vh] object-contain rounded"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
