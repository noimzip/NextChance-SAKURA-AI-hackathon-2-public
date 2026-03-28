import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar, type TabId } from "@/components/layout/Sidebar";
import { SecretarySection } from "@/components/SecretarySection";
import { ScheduleList } from "@/components/schedule/ScheduleList";
import { PhotoChecker } from "@/components/photo-checker/PhotoChecker";
import { EffortGrass } from "@/components/effort-grass/EffortGrass";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/useTheme";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useSchedule } from "@/hooks/useSchedule";
import { useScheduleReminders } from "@/hooks/useScheduleReminders";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

type ViewMode = "single" | "dashboard";

/**
 * Root Application Component - Bold Minimalism + Theme Support
 *
 * UX Design Rationale:
 * - ThemeProvider wraps entire app for consistent theme state
 * - Skip link for screen reader users (WCAG 2.1 AAA)
 * - Semantic landmarks for accessibility
 * - Smooth color transitions when theme changes
 */
export default function App() {
  const { schedules } = useSchedule();
  useScheduleReminders(schedules);

  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useLocalStorage<boolean>(
    "grass-secretary-sidebar-open",
    true,
  );

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  return (
    <ThemeProvider>
      <TooltipProvider>
        <div className="flex h-[100dvh] min-h-screen flex-col overflow-hidden overflow-x-hidden bg-background text-foreground transition-colors duration-300">
          {/* Skip Link - WCAG 2.1 AAA Accessibility */}
          <a
            href="#main-content"
            className={cn(
              "sr-only focus:not-sr-only",
              "focus:absolute focus:top-4 focus:left-4 focus:z-[100]",
              "bg-primary text-primary-foreground",
              "px-4 py-2 rounded-md font-medium",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            )}
          >
            メインコンテンツへスキップ
          </a>

          <Header viewMode={viewMode} onViewModeChange={setViewMode} />

          <div className="relative flex flex-1 min-h-0 overflow-hidden">
            {viewMode === "single" && isSidebarOpen && (
              <Sidebar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                selectedDate={selectedDate}
                onDateSelect={setSelectedDate}
                isOpen={isSidebarOpen}
                onToggle={toggleSidebar}
                className="hidden sm:flex h-full shrink-0"
              />
            )}

            {viewMode === "single" && !isSidebarOpen && (
              <button
                type="button"
                onClick={toggleSidebar}
                className={cn(
                  "hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 z-20",
                  "h-12 w-8 items-center justify-center rounded-r-lg",
                  "border border-border/60 bg-card text-muted-foreground",
                  "hover:text-foreground hover:bg-accent transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
                aria-label="サイドバーを表示"
                aria-expanded={false}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <main
              id="main-content"
              className={cn(
                "flex min-h-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8",
                viewMode === "single" && activeTab !== "schedule" && activeTab !== "grass"
                  ? "overflow-hidden"
                  : "overflow-y-auto",
                viewMode === "single" && !isSidebarOpen && "sm:pl-12",
              )}
              role="main"
              aria-label="メインコンテンツ"
              tabIndex={-1}
            >
              {viewMode === "single" ? (
                <div
                  className={cn(
                    "flex w-full flex-1 flex-col",
                    activeTab === "schedule" || activeTab === "grass"
                      ? "min-h-full"
                      : "h-full min-h-0 overflow-hidden",
                  )}
                >
                  {activeTab === "chat" && <SecretarySection className="h-full min-h-0 flex-1" />}
                  {activeTab === "schedule" && (
                    <ScheduleList
                      className="min-h-0"
                      selectedDate={selectedDate}
                      onDateSelect={setSelectedDate}
                    />
                  )}
                  {activeTab === "photo" && <PhotoChecker className="h-full min-h-0 flex-1" />}
                  {activeTab === "grass" && <EffortGrass />}
                </div>
              ) : (
                <div className="max-w-7xl mx-auto">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
                    {/* Chat Panel */}
                    <section
                      className="md:col-span-1 h-[420px] sm:h-[500px] lg:h-[600px]"
                      aria-label="AIチャット"
                    >
                      <SecretarySection className="h-full" />
                    </section>

                    {/* Schedule List */}
                    <section
                      className="md:col-span-1 h-[420px] sm:h-[500px] lg:h-[600px]"
                      aria-label="スケジュール"
                    >
                      <ScheduleList
                        className="h-full"
                        selectedDate={selectedDate}
                        onDateSelect={setSelectedDate}
                      />
                    </section>

                    {/* Effort Grass */}
                    <section className="md:col-span-2" aria-label="努力の記録">
                      <EffortGrass />
                    </section>

                    {/* Photo Checker */}
                    <section
                      className="md:col-span-2 h-[420px] sm:h-[500px]"
                      aria-label="持ち物チェック"
                    >
                      <PhotoChecker className="h-full" />
                    </section>
                  </div>
                </div>
              )}
            </main>
          </div>

          {/* Mobile bottom navigation */}
          {viewMode === "single" && (
            <nav
              className="sm:hidden border-t border-border/50 bg-card sticky bottom-0 z-40"
              aria-label="モバイルナビゲーション"
            >
              <Sidebar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                selectedDate={selectedDate}
                onDateSelect={setSelectedDate}
              />
            </nav>
          )}

          {/* Mobile view mode toggle */}
          <div className="sm:hidden h-0" />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
