const ID_MAP = new Map<string, string>();

export function registerIds(fullId: string): string {
  const short = fullId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toLowerCase();
  ID_MAP.set(short, fullId);
  return short;
}

export function resolveId(input: string): string {
  const normalized = input.toLowerCase();
  if (normalized.length <= 8) {
    const full = ID_MAP.get(normalized);
    if (full) return full;
  }
  return input;
}

export function clearIds(): void {
  ID_MAP.clear();
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function relativeDate(d: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 0 && diff <= 7) return DAY_NAMES[d.getDay()]!;
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

export function formatDateHeader(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()} (${DAY_NAMES[d.getDay()]})`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()} ${formatTime(iso)}`;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

// Date parsing — flexible, LLM-tolerant
export function parseDate(input: string): Date {
  const lower = input.toLowerCase().trim();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (lower === "today" || lower === "aujourd'hui") return today;
  if (lower === "tomorrow" || lower === "demain") return addDays(today, 1);
  if (lower === "yesterday" || lower === "hier") return addDays(today, -1);

  if (lower === "next week" || lower === "semaine prochaine") {
    const monday = addDays(today, ((1 - today.getDay() + 7) % 7) || 7);
    return monday;
  }
  if (lower === "this week" || lower === "cette semaine") {
    const monday = addDays(today, -(((today.getDay() + 6) % 7)));
    return monday;
  }

  const nextMatch = lower.match(/^next\s+(\w+)$/);
  if (nextMatch) {
    const dayIdx = parseDayName(nextMatch[1]!);
    if (dayIdx >= 0) {
      let diff = (dayIdx - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      return addDays(today, diff);
    }
  }

  const dayIdx = parseDayName(lower);
  if (dayIdx >= 0) {
    let diff = (dayIdx - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return addDays(today, diff);
  }

  // ISO: 2026-06-25
  const isoMatch = lower.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) return new Date(+isoMatch[1]!, +isoMatch[2]! - 1, +isoMatch[3]!);

  // DD/MM or DD/MM/YYYY
  const slashMatch = lower.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (slashMatch) {
    const year = slashMatch[3] ? +slashMatch[3] : now.getFullYear();
    return new Date(year, +slashMatch[2]! - 1, +slashMatch[1]!);
  }

  // "jun 25" or "25 jun" or "june 25"
  const monthDayMatch = lower.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (monthDayMatch) {
    const mi = parseMonthName(monthDayMatch[1]!);
    if (mi >= 0) return new Date(now.getFullYear(), mi, +monthDayMatch[2]!);
  }
  const dayMonthMatch = lower.match(/^(\d{1,2})\s+([a-z]+)$/);
  if (dayMonthMatch) {
    const mi = parseMonthName(dayMonthMatch[2]!);
    if (mi >= 0) return new Date(now.getFullYear(), mi, +dayMonthMatch[1]!);
  }

  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) return parsed;

  throw new Error(`Cannot parse date "${input}". Try: tomorrow, next monday, jun 25, 2026-06-25`);
}

export function parseDateRange(input: string): [Date, Date] {
  const lower = input.toLowerCase().trim();

  if (lower === "next week" || lower === "semaine prochaine") {
    const monday = parseDate("next week");
    return [monday, addDays(monday, 6)];
  }
  if (lower === "this week" || lower === "cette semaine") {
    const monday = parseDate("this week");
    return [monday, addDays(monday, 6)];
  }

  // Range: "jun 25-28"
  const rangeMatch = lower.match(/^([a-z]+)\s+(\d{1,2})-(\d{1,2})$/);
  if (rangeMatch) {
    const mi = parseMonthName(rangeMatch[1]!);
    if (mi >= 0) {
      const year = new Date().getFullYear();
      return [new Date(year, mi, +rangeMatch[2]!), new Date(year, mi, +rangeMatch[3]!)];
    }
  }

  const d = parseDate(input);
  return [d, d];
}

export function dateToRFC3339(d: Date): string {
  return d.toISOString();
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0, dimanche: 0, dim: 0,
  mon: 1, monday: 1, lundi: 1, lun: 1,
  tue: 2, tuesday: 2, mardi: 2, mar: 2,
  wed: 3, wednesday: 3, mercredi: 3, mer: 3,
  thu: 4, thursday: 4, jeudi: 4, jeu: 4,
  fri: 5, friday: 5, vendredi: 5, ven: 5,
  sat: 6, saturday: 6, samedi: 6, sam: 6,
};

function parseDayName(s: string): number {
  return DAY_MAP[s.toLowerCase()] ?? -1;
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0, janvier: 0, janv: 0,
  feb: 1, february: 1, février: 1, fevrier: 1, fev: 1,
  mar: 2, march: 2, mars: 2,
  apr: 3, april: 3, avril: 3, avr: 3,
  may: 4, mai: 4,
  jun: 5, june: 5, juin: 5,
  jul: 6, july: 6, juillet: 6, juil: 6,
  aug: 7, august: 7, août: 7, aout: 7,
  sep: 8, september: 8, septembre: 8, sept: 8,
  oct: 9, october: 9, octobre: 9,
  nov: 10, november: 10, novembre: 10,
  dec: 11, december: 11, décembre: 11, decembre: 11,
};

function parseMonthName(s: string): number {
  return MONTH_MAP[s.toLowerCase()] ?? -1;
}
