import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Check, AlertCircle, HelpCircle, ListChecks, PlusCircle } from "lucide-react";
import type { PhotoCheckResult } from "@/types";

interface CheckResultProps {
  result: PhotoCheckResult;
  className?: string;
}

export function CheckResult({ result, className }: CheckResultProps) {
  const hasComparison =
    Array.isArray(result.expectedItems) &&
    result.expectedItems.length > 0 &&
    (Array.isArray(result.matchedItems) || Array.isArray(result.extraItems));

  return (
    <div className={cn("space-y-4", className)}>
      {hasComparison && (
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
            <ListChecks className="h-4 w-4 text-primary" />
            必要な持ち物（照合結果）
          </h4>
          <div className="flex flex-wrap gap-2">
            {(result.expectedItems ?? []).map((item) => {
              const matched = (result.matchedItems ?? []).includes(item);
              return (
                <Badge
                  key={item}
                  variant={matched ? "secondary" : "outline"}
                  className={cn(
                    "flex items-center gap-1",
                    matched ? "" : "border-amber-300 text-amber-700",
                  )}
                >
                  {matched ? (
                    <Check className="h-3 w-3 text-primary" />
                  ) : (
                    <HelpCircle className="h-3 w-3" />
                  )}
                  {item}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
          <Check className="h-4 w-4 text-primary" />
          検出されたアイテム
        </h4>
        <div className="flex flex-wrap gap-2">
          {result.detectedItems.map((item) => (
            <Badge key={item.name} variant="secondary" className="flex items-center gap-1">
              <Check className="h-3 w-3 text-primary" />
              {item.name}
              <span className="text-muted-foreground text-[10px]">
                {Math.round(item.confidence * 100)}%
              </span>
            </Badge>
          ))}
          {result.detectedItems.length === 0 && (
            <span className="text-sm text-muted-foreground">アイテムが検出されませんでした</span>
          )}
        </div>
      </div>

      {(result.extraItems?.length ?? 0) > 0 && (
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-2 text-emerald-700">
            <PlusCircle className="h-4 w-4" />
            その他検出されたアイテム
          </h4>
          <div className="flex flex-wrap gap-2">
            {(result.extraItems ?? []).map((item) => (
              <Badge
                key={item}
                variant="outline"
                className="border-emerald-300 text-emerald-700 flex items-center gap-1"
              >
                <PlusCircle className="h-3 w-3" />
                {item}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {(result.suggestedItems?.length ?? 0) > 0 && (
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-2 text-blue-700">
            <PlusCircle className="h-4 w-4" />
            過去予定ベースの提案持ち物
          </h4>
          <div className="space-y-1.5">
            {(result.suggestedItems ?? []).map((entry) => (
              <div
                key={`${entry.item}-${entry.sourceScheduleTitles.join("|")}`}
                className="rounded-md border px-2 py-1.5"
              >
                <p className="text-xs font-medium">{entry.item}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  参考: {entry.sourceScheduleTitles.join(" / ")}
                </p>
              </div>
            ))}
          </div>
          {(result.appliedSuggestedItems?.length ?? 0) > 0 && (
            <p className="text-[11px] text-blue-700 mt-2">
              照合に適用: {result.appliedSuggestedItems?.join(" / ")}
            </p>
          )}
        </div>
      )}

      {result.missingItems.length > 0 && (
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-2 text-amber-600">
            <AlertCircle className="h-4 w-4" />
            確認が必要なアイテム
          </h4>
          <div className="flex flex-wrap gap-2">
            {result.missingItems.map((item) => (
              <Badge
                key={item}
                variant="outline"
                className="border-amber-300 text-amber-700 flex items-center gap-1"
              >
                <HelpCircle className="h-3 w-3" />
                {item}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        解析日時: {new Date(result.timestamp).toLocaleString("ja-JP")}
      </p>
    </div>
  );
}
