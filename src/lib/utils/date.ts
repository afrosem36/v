import { format, parseISO, differenceInCalendarDays, startOfDay } from "date-fns";
import type { DayOfWeek } from "@/types/domain";

export function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function dateStr(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function dayOfWeekOf(d: Date): DayOfWeek {
  return d.getDay() as DayOfWeek;
}

export function formatFriendlyDate(iso: string): string {
  return format(parseISO(iso), "MMMM d, yyyy");
}

export function formatShortDate(iso: string): string {
  return format(parseISO(iso), "MMM d");
}

export function formatTime(iso: string): string {
  return format(parseISO(iso), "h:mm a");
}

export function daysAgo(iso: string): number {
  return differenceInCalendarDays(startOfDay(new Date()), startOfDay(parseISO(iso)));
}

export function isSameDay(iso: string, dateOnly: string): boolean {
  return iso.startsWith(dateOnly);
}

/** Indexed by DayOfWeek (0 = Sunday), matching Date.getDay(). */
export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Monday-first week order, for UIs that show a training week rather than a calendar week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function formatDayAndDate(iso: string): string {
  return format(parseISO(iso), "EEE, MMM d");
}
