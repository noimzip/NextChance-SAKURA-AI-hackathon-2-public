import { cn } from "@/lib/utils";

export function GrassLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <span>少ない</span>
      <div className="flex gap-0.5">
        <div className="w-3 h-3 rounded-[2px] bg-grass-0" />
        <div className="w-3 h-3 rounded-[2px] bg-grass-1" />
        <div className="w-3 h-3 rounded-[2px] bg-grass-2" />
        <div className="w-3 h-3 rounded-[2px] bg-grass-3" />
        <div className="w-3 h-3 rounded-[2px] bg-grass-4" />
      </div>
      <span>多い</span>
    </div>
  );
}
