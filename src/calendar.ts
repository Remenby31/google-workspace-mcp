import { google } from "googleapis";
import type { OAuth2Client } from "googleapis-common";
import { ACTION_ALIASES, RSVP_ALIASES, extractFlag } from "./commands.ts";
import {
  registerIds, resolveId, formatDateHeader, formatTime,
  parseDate, parseDateRange, dateToRFC3339, endOfDay, truncate,
} from "./format.ts";

function getMeetLink(event: any): string {
  const conf = event.conferenceData;
  if (conf?.entryPoints) {
    for (const ep of conf.entryPoints) {
      if (ep.entryPointType === "video" && ep.uri) return ep.uri;
    }
  }
  return event.hangoutLink || "";
}

function formatEventLine(event: any): string {
  const id = registerIds(event.id);
  const summary = event.summary || "(no title)";
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  const meet = getMeetLink(event);

  if (!start?.includes("T")) {
    // All-day event
    const meetPart = meet ? `  \u{1F4F9} ${meet.replace("https://", "")}` : "";
    return `  [\u{2014}\u{2014}\u{2014}\u{2014}\u{2014}\u{2014}] all-day       ${summary}${meetPart}`;
  }

  const startTime = formatTime(start);
  const endTime = end ? formatTime(end) : "";
  const timeStr = `${startTime}-${endTime}`.padEnd(11);
  const meetPart = meet ? `  \u{1F4F9} ${meet.replace("https://", "")}` : "";
  return `  [${id}] ${timeStr}  ${summary}${meetPart}`;
}

function formatEventDetail(event: any): string {
  const id = registerIds(event.id);
  const lines: string[] = [];
  lines.push(`${event.summary || "(no title)"} [${id}]`);

  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  const tz = event.start?.timeZone || "";
  if (start?.includes("T")) {
    const d = new Date(start);
    const startStr = `${formatDateHeader(d)}, ${formatTime(start)}`;
    const endStr = end ? `-${formatTime(end)}` : "";
    lines.push(`  When: ${startStr}${endStr}${tz ? ` (${tz})` : ""}`);
  } else {
    lines.push(`  When: ${start} (all-day)`);
  }

  const meet = getMeetLink(event);
  if (meet) lines.push(`  Meet: ${meet}`);
  if (event.location) lines.push(`  Location: ${event.location}`);
  if (event.organizer?.email) lines.push(`  Organizer: ${event.organizer.email}`);

  if (event.attendees?.length) {
    const atts = event.attendees.map((a: any) => {
      const status = a.responseStatus || "unknown";
      return `${a.email} (${status})`;
    });
    lines.push(`  Attendees: ${atts.join(", ")}`);
  }

  if (event.description) {
    lines.push(`  Description: ${truncate(event.description, 500)}`);
  }

  return lines.join("\n");
}

export async function handleCalendar(auth: OAuth2Client, email: string, parts: string[]): Promise<string> {
  const cal = google.calendar({ version: "v3", auth });
  const rawAction = parts[0]?.toLowerCase() || "";
  const action = ACTION_ALIASES[rawAction] || rawAction;

  // Default: list events for today + 3 days
  if (!rawAction || isDateLike(rawAction)) {
    return listEvents(cal, email, parts);
  }

  switch (action) {
    case "search": return searchEvents(cal, email, parts.slice(1));
    case "detail": return detailEvent(cal, parts.slice(1));
    case "create": return createEvent(cal, parts.slice(1));
    case "update": return updateEvent(cal, parts.slice(1));
    case "delete": return deleteEvent(cal, parts.slice(1));
    case "rsvp": return rsvpEvent(cal, parts.slice(1));
    case "busy": return busySlots(cal, email, parts.slice(1));
    case "calendars": return listCalendars(cal, email);
    default:
      if (isDateLike(rawAction)) return listEvents(cal, email, parts);
      return `Unknown calendar action "${rawAction}". Available: search, detail, create, update, delete, rsvp, busy, calendars`;
  }
}

function isDateLike(s: string): boolean {
  const lower = s.toLowerCase();
  return /^\d/.test(lower) ||
    ["today", "tomorrow", "yesterday", "next", "this", "demain", "hier", "aujourd'hui"].some(k => lower.startsWith(k)) ||
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "lun", "mar", "mer", "jeu", "ven", "sam", "dim"]
      .some(k => lower.startsWith(k));
}

async function listEvents(cal: any, email: string, parts: string[]): Promise<string> {
  let timeMin: Date, timeMax: Date;

  if (parts.length > 0) {
    const input = parts.join(" ");
    [timeMin, timeMax] = parseDateRange(input);
    timeMax = endOfDay(timeMax);
  } else {
    timeMin = new Date();
    timeMin.setHours(0, 0, 0, 0);
    timeMax = endOfDay(new Date(timeMin.getTime() + 3 * 86400000));
  }

  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: dateToRFC3339(timeMin),
    timeMax: dateToRFC3339(timeMax),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });

  const events = res.data.items || [];
  if (events.length === 0) return `No events found \u{2014} ${email}`;

  // Group by day
  const groups = new Map<string, any[]>();
  for (const ev of events) {
    const start = ev.start?.dateTime || ev.start?.date || "";
    const day = start.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(ev);
  }

  const lines: string[] = [];
  let first = true;
  for (const [day, evts] of groups) {
    const d = new Date(day + "T00:00:00");
    const header = formatDateHeader(d);
    lines.push(`${first ? `${header} \u{2014} ${email}` : header}`);
    for (const ev of evts) lines.push(formatEventLine(ev));
    first = false;
  }

  return lines.join("\n");
}

async function searchEvents(cal: any, email: string, parts: string[]): Promise<string> {
  if (parts.length === 0) return 'Missing query. Usage: cal search <query>';

  const query = parts.join(" ");
  const now = new Date();
  const res = await cal.events.list({
    calendarId: "primary",
    q: query,
    timeMin: new Date(now.getFullYear(), 0, 1).toISOString(),
    timeMax: new Date(now.getFullYear() + 1, 0, 1).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 20,
  });

  const events = res.data.items || [];
  if (events.length === 0) return `No events matching "${query}"`;

  const lines = [`Search: "${query}" \u{2014} ${events.length} results`];
  for (const ev of events) {
    const id = registerIds(ev.id);
    const start = ev.start?.dateTime || ev.start?.date || "";
    const dateStr = start.slice(0, 10);
    const time = start.includes("T") ? ` ${formatTime(start)}` : "";
    lines.push(`  [${id}] ${dateStr}${time}  ${ev.summary || "(no title)"}`);
  }
  return lines.join("\n");
}

async function detailEvent(cal: any, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing event ID. Run 'cal' first to get IDs.";
  const eventId = resolveId(parts[0]!);
  const res = await cal.events.get({ calendarId: "primary", eventId });
  return formatEventDetail(res.data);
}

async function createEvent(cal: any, parts: string[]): Promise<string> {
  if (parts.length < 3) {
    return 'Usage: cal create <title> <start> <end> [--meet] [--invite a@b.com]\nExample: cal create "Meeting" "tomorrow 14:00" "tomorrow 15:00"';
  }

  const hasMeet = extractFlag(parts, "--meet");
  const inviteIdx = parts.indexOf("--invite");
  let attendees: string[] = [];
  if (inviteIdx >= 0 && inviteIdx + 1 < parts.length) {
    attendees = parts[inviteIdx + 1]!.split(",");
    parts.splice(inviteIdx, 2);
  }

  const title = parts[0]!;
  const startStr = parts[1]!;
  const endStr = parts[2]!;

  const body: any = {
    summary: title,
    start: { dateTime: dateToRFC3339(parseDate(startStr)) },
    end: { dateTime: dateToRFC3339(parseDate(endStr)) },
  };

  if (hasMeet) {
    body.conferenceData = {
      createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  if (attendees.length > 0) {
    body.attendees = attendees.map(e => ({ email: e.trim() }));
  }

  const res = await cal.events.insert({
    calendarId: "primary",
    requestBody: body,
    conferenceDataVersion: hasMeet ? 1 : 0,
  });

  const id = registerIds(res.data.id);
  return `Created: ${title} [${id}]`;
}

async function updateEvent(cal: any, parts: string[]): Promise<string> {
  if (parts.length < 2) return "Usage: cal update <id> --title/--start/--end <value>";

  const eventId = resolveId(parts.shift()!);
  const current = await cal.events.get({ calendarId: "primary", eventId });
  const body = current.data;

  while (parts.length > 0) {
    const flag = parts.shift()!;
    const val = parts.shift();
    if (!val) break;
    switch (flag) {
      case "--title": body.summary = val; break;
      case "--start": body.start = { dateTime: dateToRFC3339(parseDate(val)) }; break;
      case "--end": body.end = { dateTime: dateToRFC3339(parseDate(val)) }; break;
      case "--location": body.location = val; break;
      case "--description": body.description = val; break;
    }
  }

  await cal.events.update({ calendarId: "primary", eventId, requestBody: body });
  const id = registerIds(eventId);
  return `Updated event [${id}]`;
}

async function deleteEvent(cal: any, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing event ID. Run 'cal' first to get IDs.";
  const eventId = resolveId(parts[0]!);
  await cal.events.delete({ calendarId: "primary", eventId });
  return `Deleted event [${parts[0]}]`;
}

async function rsvpEvent(cal: any, parts: string[]): Promise<string> {
  if (parts.length < 2) return "Usage: cal rsvp <id> <yes|no|maybe>";
  const eventId = resolveId(parts[0]!);
  const rawResponse = parts[1]!.toLowerCase();
  const response = RSVP_ALIASES[rawResponse] || rawResponse;

  if (!["accepted", "declined", "tentative"].includes(response)) {
    return `Invalid RSVP "${rawResponse}". Use: yes, no, maybe`;
  }

  const event = await cal.events.get({ calendarId: "primary", eventId });
  const attendees = event.data.attendees || [];
  // Find self and update response
  for (const a of attendees) {
    if (a.self) a.responseStatus = response;
  }

  await cal.events.update({
    calendarId: "primary",
    eventId,
    requestBody: { ...event.data, attendees },
  });

  return `RSVP: ${response} for "${event.data.summary}"`;
}

async function busySlots(cal: any, email: string, parts: string[]): Promise<string> {
  let timeMin: Date, timeMax: Date;
  if (parts.length > 0) {
    [timeMin, timeMax] = parseDateRange(parts.join(" "));
    timeMax = endOfDay(timeMax);
  } else {
    timeMin = new Date();
    timeMin.setHours(0, 0, 0, 0);
    timeMax = endOfDay(timeMin);
  }

  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: dateToRFC3339(timeMin),
      timeMax: dateToRFC3339(timeMax),
      items: [{ id: "primary" }],
    },
  });

  const busy = res.data.calendars?.primary?.busy || [];
  if (busy.length === 0) return `No busy slots \u{2014} completely free`;

  const lines = [`Busy slots \u{2014} ${email}`];
  for (const slot of busy) {
    lines.push(`  ${formatTime(slot.start)} - ${formatTime(slot.end)}`);
  }
  return lines.join("\n");
}

async function listCalendars(cal: any, email: string): Promise<string> {
  const res = await cal.calendarList.list();
  const items = res.data.items || [];
  const lines = [`Calendars \u{2014} ${email}`];
  for (const c of items) {
    const primary = c.primary ? " (primary)" : "";
    lines.push(`  ${c.summary}${primary}  [${c.id}]`);
  }
  return lines.join("\n");
}
