import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import type { ScheduleItem, Tag } from "@/types";

const mockGetUpcoming = () => {
  const tags: Tag[] = [];
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(11, 30, 0, 0);
  const scheduleWithEndDate: ScheduleItem = {
    id: "schedule-1",
    title: "会議",
    mode: "schedule",
    dueDate: start,
    endDate: end,
    completed: false,
    reminderOffsetsMinutes: [60],
    tags,
    createdAt: new Date(),
  };

  return [scheduleWithEndDate];
};

vi.mock("@/hooks/useSchedule", () => ({
  useSchedule: () => ({
    getCalendarEventsByDate: () => new Map(),
    getUpcoming: mockGetUpcoming,
  }),
}));

import { Sidebar } from "@/components/layout/Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("shows schedule end date in upcoming list", () => {
    render(
      <Sidebar
        activeTab="schedule"
        onTabChange={() => {}}
        selectedDate={null}
        onDateSelect={() => {}}
        isOpen
      />,
    );

    expect(screen.getByTitle("会議")).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("〜"))).toBeInTheDocument();
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    expect(screen.getByText(/11:30/)).toBeInTheDocument();
  });
});
