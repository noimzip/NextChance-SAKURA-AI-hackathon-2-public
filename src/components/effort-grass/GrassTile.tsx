import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EffortLog } from "@/types";

interface GrassTileProps {
  log: EffortLog;
  className?: string;
}

function getActivityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

export function GrassTile({ log, className }: GrassTileProps) {
  const level = getActivityLevel(log.count);

  const levelColors = {
    0: "bg-grass-0",
    1: "bg-grass-1",
    2: "bg-grass-2",
    3: "bg-grass-3",
    4: "bg-grass-4",
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "w-3 h-3 rounded-[2px] cursor-pointer transition-transform hover:scale-125",
            levelColors[level],
            className,
          )}
          role="gridcell"
          aria-label={`${formatDate(log.date)}: ${log.count}件のアクティビティ`}
        />
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <p className="font-medium">{formatDate(log.date)}</p>
        <p>{log.count > 0 ? `${log.count}件のアクティビティ` : "アクティビティなし"}</p>
        {log.activities.length > 0 && (
          <ul className="mt-1 text-muted-foreground">
            {log.activities.slice(0, 3).map((a) => (
              <li key={a.id}>• {a.description}</li>
            ))}
            {log.activities.length > 3 && <li>• 他 {log.activities.length - 3}件</li>}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
