import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sprout, LayoutGrid, Layers, Moon, Sun, Menu } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import type { Theme } from "@/hooks/useTheme";

interface HeaderProps {
  className?: string;
  viewMode: "single" | "dashboard";
  onViewModeChange: (mode: "single" | "dashboard") => void;
}

const themeLabels: Record<Theme, string> = {
  light: "ライト",
  dark: "ダーク",
  system: "システム",
};

/**
 * Header Component - Bold Minimalism + Theme Toggle
 *
 * UX Design Rationale:
 * - Theme toggle cycles through light → dark → system for complete control
 * - Visual feedback with animated icon transitions
 * - Elevated surface creates visual hierarchy from background
 */
export function Header({ className, viewMode, onViewModeChange }: HeaderProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const cycleTheme = () => {
    const themes: Theme[] = ["light", "dark", "system"];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full",
        "border-b border-border/50",
        "bg-card/95 backdrop-blur-md",
        className,
      )}
      role="banner"
    >
      <div className="container flex h-16 sm:h-18 items-center justify-between px-3 sm:px-4 lg:px-8">
        {/* Brand Identity */}
        <div className="flex items-center gap-2.5 sm:gap-4">
          <div
            className={cn(
              "relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center",
              "rounded-xl bg-primary/15 text-primary",
              "ring-1 ring-primary/30",
              "transition-all duration-300 hover:scale-105 hover:ring-primary/50",
            )}
            aria-hidden="true"
          >
            <Sprout className="h-6 w-6" />
            <div
              className={cn(
                "absolute -right-0.5 -top-0.5 h-2.5 w-2.5",
                "rounded-full bg-primary",
                "ring-2 ring-card animate-pulse",
              )}
            />
          </div>
          <div className="space-y-0.5">
            <h1 className="text-base sm:text-xl font-bold tracking-tight text-foreground">
              Grass-Secretary
            </h1>
            <p className="hidden sm:block text-xs text-muted-foreground tracking-wide">
              あなたの毎日をサポートするAI秘書
            </p>
          </div>
        </div>

        {/* Navigation Controls */}
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="表示モード切替">
          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={cycleTheme}
            className={cn(
              "relative h-11 w-11 sm:h-9 sm:w-9 p-0",
              "transition-all duration-200",
              "hover:bg-accent",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
            aria-label={`テーマを切り替え（現在: ${themeLabels[theme]}）`}
            title={`テーマ: ${themeLabels[theme]}`}
          >
            {/* Moon icon for dark mode */}
            <Moon
              className={cn(
                "h-4 w-4 absolute transition-all duration-300",
                resolvedTheme === "dark"
                  ? "rotate-0 scale-100 opacity-100"
                  : "rotate-90 scale-0 opacity-0",
              )}
            />
            {/* Sun icon for light mode */}
            <Sun
              className={cn(
                "h-4 w-4 absolute transition-all duration-300",
                resolvedTheme === "light"
                  ? "rotate-0 scale-100 opacity-100"
                  : "-rotate-90 scale-0 opacity-0",
              )}
            />
            {/* System indicator dot */}
            {theme === "system" && (
              <span
                className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary ring-1 ring-card"
                aria-hidden="true"
              />
            )}
          </Button>

          {/* View Mode Toggle */}
          <div
            className={cn(
              "hidden md:flex items-center gap-1",
              "bg-muted/50 rounded-lg p-1",
              "ring-1 ring-border/50",
            )}
            role="tablist"
            aria-label="レイアウト選択"
          >
            <Button
              variant={viewMode === "single" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onViewModeChange("single")}
              className={cn(
                "h-9 px-3 transition-all duration-200",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                viewMode === "single" && "bg-secondary shadow-sm text-foreground",
              )}
              role="tab"
              aria-selected={viewMode === "single"}
              aria-controls="main-content"
            >
              <Layers className="h-4 w-4 mr-2" aria-hidden="true" />
              <span className="text-sm font-medium">切替表示</span>
            </Button>
            <Button
              variant={viewMode === "dashboard" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onViewModeChange("dashboard")}
              className={cn(
                "h-9 px-3 transition-all duration-200",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                viewMode === "dashboard" && "bg-secondary shadow-sm text-foreground",
              )}
              role="tab"
              aria-selected={viewMode === "dashboard"}
              aria-controls="main-content"
            >
              <LayoutGrid className="h-4 w-4 mr-2" aria-hidden="true" />
              <span className="text-sm font-medium">一覧表示</span>
            </Button>
          </div>

          {/* Mobile Navigation/Mode Menu */}
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "h-11 w-11 md:hidden",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="表示設定を開く"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>

          {/* Tagline */}
          <span
            className={cn(
              "hidden lg:flex items-center gap-2",
              "text-sm text-muted-foreground font-medium",
              "pl-3 border-l border-border/50",
            )}
          >
            <span className="text-primary" aria-hidden="true">
              🌱
            </span>
            <span>努力を芝に、AIを秘書に</span>
          </span>
        </nav>
      </div>

      <Dialog open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] rounded-xl p-4 md:hidden">
          <DialogHeader>
            <DialogTitle>表示設定</DialogTitle>
            <DialogDescription>スマホでは切替表示のみ利用できます。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              variant={viewMode === "single" ? "secondary" : "outline"}
              className="h-12 w-full justify-start"
              onClick={() => {
                onViewModeChange("single");
                setIsMobileMenuOpen(false);
              }}
            >
              <Layers className="h-4 w-4 mr-2" aria-hidden="true" />
              切替表示
            </Button>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
