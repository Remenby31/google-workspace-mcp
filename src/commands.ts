import { getAuthenticatedClient, getDefaultEmail, AuthRequiredError } from "./auth.ts";
import { handleCalendar } from "./calendar.ts";
import { handleMail } from "./gmail.ts";
import { handleDrive } from "./drive.ts";

const SERVICE_ALIASES: Record<string, string> = {
  cal: "cal", calendar: "cal", agenda: "cal", events: "cal", rdv: "cal", calendrier: "cal",
  mail: "mail", gmail: "mail", email: "mail", emails: "mail", mails: "mail", inbox: "mail",
  drive: "drive", gdrive: "drive", files: "drive", fichiers: "drive",
  help: "help", "?": "help", h: "help", aide: "help",
};

export const ACTION_ALIASES: Record<string, string> = {
  search: "search", find: "search", cherche: "search", chercher: "search",
  read: "read", get: "read", show: "read", open: "read", view: "read", lire: "read",
  send: "send", envoie: "send", envoyer: "send",
  create: "create", new: "create", add: "create", creer: "create", "créer": "create",
  delete: "delete", rm: "delete", remove: "delete", del: "delete", supprimer: "delete",
  update: "update", edit: "update", modify: "update", modifier: "update",
  reply: "reply", respond: "reply", repondre: "reply", "répondre": "reply",
  detail: "detail", details: "detail", "détail": "detail",
  list: "list", ls: "list", dir: "list",
  tag: "tag", label: "tag", move: "tag",
  thread: "thread", conversation: "thread", conv: "thread",
  draft: "draft", brouillon: "draft",
  busy: "busy", free: "busy", freebusy: "busy", dispo: "busy",
  rsvp: "rsvp",
  calendars: "calendars",
  labels: "labels",
  info: "info", metadata: "info", meta: "info", permissions: "info",
  share: "share", partager: "share",
  link: "link", url: "link", lien: "link",
  mkdir: "mkdir",
  cp: "cp", copy: "cp", copier: "cp",
  attach: "attach", attachment: "attach", "pièce-jointe": "attach", pj: "attach",
};

export const RSVP_ALIASES: Record<string, string> = {
  yes: "accepted", oui: "accepted", ok: "accepted", accept: "accepted", accepted: "accepted",
  no: "declined", non: "declined", decline: "declined", declined: "declined", refuse: "declined",
  maybe: "tentative", "peut-etre": "tentative", "peut-être": "tentative", tentative: "tentative",
};

function helpText(): string {
  return [
    "Google Workspace CLI",
    "",
    "CALENDAR",
    "  cal                              Today + 3 days",
    "  cal <date|range>                 Events for date/range",
    "  cal search <query>               Search events",
    "  cal detail <id>                  Full details (attendees, meet link)",
    "  cal create <title> <start> <end> Create event (--meet --invite a@b.com)",
    "  cal update <id> --title/start/end  Update event",
    "  cal delete <id>                  Delete event",
    "  cal rsvp <id> <yes|no|maybe>     RSVP to invitation",
    "  cal busy <date|range>            Free/busy slots",
    "  cal calendars                    List calendars",
    "",
    "GMAIL",
    "  mail                             Last 10 unread",
    "  mail search <query>              Search (gmail operators: from:, is:, has:)",
    "  mail read <id>                   Read message",
    "  mail thread <id>                 Read thread",
    "  mail send <to> <subject> --body  Send email",
    "  mail reply <id> --body           Reply to message",
    "  mail draft <to> <subject> --body Create draft",
    "  mail labels                      List labels",
    "  mail tag <id> +/-LABEL           Add/remove label",
    "",
    "DRIVE",
    "  drive search <query>             Search files",
    "  drive ls [folder_id]             List folder",
    "  drive read <id>                  Read file content",
    "  drive info <id>                  File metadata & permissions",
    "  drive share <id> <email> [role]  Share file",
    "  drive link <id>                  Get shareable link",
    "  drive mkdir <name>               Create folder",
    "  drive cp <id> [name]             Copy file",
    "",
    "OPTIONS",
    "  --as <email>                     Use specific account",
  ].join("\n");
}

function extractOption(parts: string[], flag: string): string | null {
  const idx = parts.indexOf(flag);
  if (idx >= 0 && idx + 1 < parts.length) {
    const val = parts[idx + 1]!;
    parts.splice(idx, 2);
    return val;
  }
  return null;
}

export function extractFlag(parts: string[], flag: string): boolean {
  const idx = parts.indexOf(flag);
  if (idx >= 0) {
    parts.splice(idx, 1);
    return true;
  }
  return false;
}

// Split command respecting quoted strings
function splitCommand(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export async function executeCommand(command: string): Promise<string> {
  const parts = splitCommand(command.trim());
  if (parts.length === 0) return helpText();

  // Extract --as email option
  const asEmail = extractOption(parts, "--as");
  const email = asEmail || getDefaultEmail();

  const rawService = parts.shift()!;
  const service = SERVICE_ALIASES[rawService.toLowerCase()];

  if (!service) {
    const known = Object.values(SERVICE_ALIASES).filter((v, i, a) => a.indexOf(v) === i);
    return `Unknown command "${rawService}". Available: ${known.join(", ")}`;
  }

  if (service === "help") return helpText();

  // Get authenticated client
  const auth = await getAuthenticatedClient(email);

  switch (service) {
    case "cal": return handleCalendar(auth, email, parts);
    case "mail": return handleMail(auth, email, parts);
    case "drive": return handleDrive(auth, email, parts);
    default: return helpText();
  }
}
