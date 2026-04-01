import { DEFAULT_COLORS } from "@/hooks/useTags";

const GOOGLE_EVENT_COLOR_BY_LOCAL: Record<string, string> = {
  [DEFAULT_COLORS[0]]: "11", // red
  [DEFAULT_COLORS[1]]: "9", // blue
  [DEFAULT_COLORS[2]]: "10", // green
  [DEFAULT_COLORS[3]]: "10", // green
  [DEFAULT_COLORS[4]]: "7", // cyan
  [DEFAULT_COLORS[5]]: "9", // blue
  [DEFAULT_COLORS[6]]: "3", // purple
  [DEFAULT_COLORS[7]]: "4", // pink
};

const LOCAL_COLOR_BY_GOOGLE_EVENT: Record<string, string> = {
  "1": DEFAULT_COLORS[5], // lavender -> blue
  "2": DEFAULT_COLORS[3], // sage -> green
  "3": DEFAULT_COLORS[6], // grape -> purple
  "4": DEFAULT_COLORS[7], // flamingo -> pink
  "5": DEFAULT_COLORS[1], // banana -> blue
  "6": DEFAULT_COLORS[4], // tangerine -> cyan
  "7": DEFAULT_COLORS[4], // peacock -> cyan
  "8": DEFAULT_COLORS[3], // graphite -> green
  "9": DEFAULT_COLORS[5], // blueberry -> blue
  "10": DEFAULT_COLORS[2], // basil -> green
  "11": DEFAULT_COLORS[0], // tomato -> red
};

export function toGoogleEventColorId(localColor: string | undefined): string | undefined {
  if (!localColor) {
    return undefined;
  }
  return GOOGLE_EVENT_COLOR_BY_LOCAL[localColor];
}

export function toLocalScheduleColor(googleColorId: string | undefined): string | undefined {
  if (!googleColorId) {
    return undefined;
  }
  return LOCAL_COLOR_BY_GOOGLE_EVENT[googleColorId];
}
