import { google } from "googleapis";
import type { OAuth2Client } from "googleapis-common";
import { ACTION_ALIASES, extractFlag } from "./commands.ts";
import { registerIds, resolveId, formatShortDate, truncate } from "./format.ts";

function decodeBody(body: any): string {
  if (!body?.data) return "";
  return Buffer.from(body.data, "base64url").toString("utf-8");
}

function extractTextBody(payload: any): string {
  if (!payload) return "[No content]";

  // Simple body
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBody(payload.body);
  }

  // Multipart — BFS for text/plain, fallback to text/html
  const parts = payload.parts || [];
  let textBody = "";
  let htmlBody = "";

  const queue = [...parts];
  while (queue.length > 0) {
    const part = queue.shift()!;
    if (part.mimeType === "text/plain" && part.body?.data) {
      textBody = decodeBody(part.body);
    } else if (part.mimeType === "text/html" && part.body?.data) {
      htmlBody = decodeBody(part.body);
    }
    if (part.parts) queue.push(...part.parts);
  }

  if (textBody) return textBody;
  if (htmlBody) return stripHtml(htmlBody);
  return "[No readable content]";
}

function stripHtml(html: string): string {
  let text = html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+$/gm, "")
    .replace(/^[ \t]+/gm, (m) => m.length > 4 ? "" : m)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Strip email signature markers (lines starting with "-- " or "--" at the end)
  text = text.replace(/\n-- ?\n[\s\S]*$/, "").trim();

  return text;
}

function getHeader(headers: any[], name: string): string {
  const h = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function getAttachments(payload: any): { id: string; name: string; mime: string }[] {
  const result: { id: string; name: string; mime: string }[] = [];
  const queue = [payload];
  while (queue.length > 0) {
    const part = queue.shift()!;
    if (part.body?.attachmentId && part.filename) {
      result.push({ id: part.body.attachmentId, name: part.filename, mime: part.mimeType || "" });
    }
    if (part.parts) queue.push(...part.parts);
  }
  return result;
}

function formatMessageLine(msg: any): string {
  const headers = msg.payload?.headers || [];
  const id = registerIds(msg.id);
  const from = getHeader(headers, "From").replace(/<[^>]+>/, "").trim();
  const subject = getHeader(headers, "Subject") || "(no subject)";
  const date = getHeader(headers, "Date");
  const dateStr = date ? formatShortDate(new Date(date).toISOString()) : "";
  const labels = msg.labelIds || [];
  const starred = labels.includes("STARRED") ? " \u2605" : "";
  const hasAttach = getAttachments(msg.payload).length > 0 ? " \u{1F4CE}" : "";
  const fromShort = truncate(from, 25).padEnd(25);
  return `  [${id}] ${dateStr}  ${fromShort}  ${truncate(subject, 40)}${starred}${hasAttach}`;
}

function formatMessageFull(msg: any): string {
  const headers = msg.payload?.headers || [];
  const id = registerIds(msg.id);
  const subject = getHeader(headers, "Subject") || "(no subject)";
  const from = getHeader(headers, "From");
  const to = getHeader(headers, "To");
  const cc = getHeader(headers, "Cc");
  const date = getHeader(headers, "Date");
  const labels = (msg.labelIds || []).join(", ");
  const threadId = msg.threadId ? registerIds(msg.threadId) : "";

  const lines: string[] = [];
  lines.push(`${subject} [${id}]`);
  lines.push(`  From: ${from}${to ? ` \u{2192} To: ${to}` : ""}`);
  if (cc) lines.push(`  Cc: ${cc}`);
  lines.push(`  Date: ${date}${threadId ? ` | Thread: [${threadId}]` : ""}`);
  if (labels) lines.push(`  Labels: ${labels}`);

  const attachments = getAttachments(msg.payload);
  if (attachments.length > 0) {
    lines.push(`  Attachments: ${attachments.map(a => `${a.name} (${a.id.slice(0, 8)})`).join(", ")}`);
  }

  lines.push("  ---");
  const body = extractTextBody(msg.payload);
  lines.push(`  ${truncate(body, 3000).split("\n").join("\n  ")}`);

  return lines.join("\n");
}

export async function handleMail(auth: OAuth2Client, email: string, parts: string[]): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth });
  const rawAction = parts[0]?.toLowerCase() || "";
  const action = ACTION_ALIASES[rawAction] || rawAction;

  if (!rawAction) return listUnread(gmail, email);

  switch (action) {
    case "search": return searchMail(gmail, email, parts.slice(1));
    case "read": return readMessage(gmail, parts.slice(1));
    case "thread": return readThread(gmail, parts.slice(1));
    case "send": return sendMessage(gmail, parts.slice(1));
    case "reply": return replyMessage(gmail, parts.slice(1));
    case "forward": return forwardMessage(gmail, parts.slice(1));
    case "draft": return draftMessage(gmail, parts.slice(1));
    case "labels": return listLabels(gmail, email);
    case "tag": return tagMessage(gmail, parts.slice(1));
    case "attach": return downloadAttachment(gmail, parts.slice(1));
    default:
      return `Unknown mail action "${rawAction}". Available: search, read, thread, send, reply, forward, draft, labels, tag, attach`;
  }
}

async function listUnread(gmail: any, email: string): Promise<string> {
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread",
    maxResults: 10,
  });

  const messages = res.data.messages || [];
  if (messages.length === 0) return `No unread emails \u{2014} ${email}`;

  const details = await Promise.all(
    messages.map((m: any) =>
      gmail.users.messages.get({ userId: "me", id: m.id, format: "full" }),
    ),
  );

  const lines = [`Inbox \u{2014} ${email} (${messages.length} unread)`];
  for (const d of details) lines.push(formatMessageLine(d.data));
  return lines.join("\n");
}

async function searchMail(gmail: any, email: string, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing query. Usage: mail search <query>\nSupports Gmail operators: from:, to:, subject:, is:, has:, after:, before:";

  const query = parts.join(" ");
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 15,
  });

  const messages = res.data.messages || [];
  if (messages.length === 0) return `No messages matching "${query}"`;

  const details = await Promise.all(
    messages.map((m: any) =>
      gmail.users.messages.get({ userId: "me", id: m.id, format: "full" }),
    ),
  );

  const lines = [`Search: "${query}" \u{2014} ${messages.length} results`];
  for (const d of details) lines.push(formatMessageLine(d.data));
  return lines.join("\n");
}

async function readMessage(gmail: any, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing message ID. Run 'mail' or 'mail search' first to get IDs.";
  const msgId = resolveId(parts[0]!);
  const res = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
  return formatMessageFull(res.data);
}

async function readThread(gmail: any, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing thread ID. Check [thread_id] in message details.";
  const threadId = resolveId(parts[0]!);
  const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  const messages = res.data.messages || [];
  const lines = [`Thread (${messages.length} messages)`];
  for (const msg of messages) lines.push(formatMessageFull(msg));
  return lines.join("\n\n");
}

function extractBody(parts: string[]): string {
  const idx = parts.indexOf("--body");
  if (idx >= 0 && idx + 1 < parts.length) {
    const body = parts.splice(idx, 2)[1]!;
    return body;
  }
  return "";
}

async function sendMessage(gmail: any, parts: string[]): Promise<string> {
  const body = extractBody(parts);
  if (parts.length < 2) return 'Usage: mail send <to> <subject> --body "content"';
  const to = parts[0]!;
  const subject = parts.slice(1).join(" ");
  if (!body) return 'Missing --body. Usage: mail send <to> <subject> --body "content"';

  const raw = createRawEmail(to, subject, body);
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  const id = registerIds(res.data.id);
  return `Sent to ${to}: "${subject}" [${id}]`;
}

async function replyMessage(gmail: any, parts: string[]): Promise<string> {
  const body = extractBody(parts);
  if (parts.length === 0) return "Usage: mail reply <message_id> --body \"content\"";
  if (!body) return 'Missing --body. Usage: mail reply <id> --body "content"';

  const msgId = resolveId(parts[0]!);
  const original = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
  const headers = original.data.payload?.headers || [];
  const to = getHeader(headers, "From");
  const subject = getHeader(headers, "Subject");
  const reSubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  const messageId = getHeader(headers, "Message-ID");

  const raw = createRawEmail(to, reSubject, body, {
    inReplyTo: messageId,
    references: messageId,
  });

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: original.data.threadId },
  });

  const id = registerIds(res.data.id);
  return `Replied to ${to}: "${reSubject}" [${id}]`;
}

async function forwardMessage(gmail: any, parts: string[]): Promise<string> {
  const body = extractBody(parts);
  if (parts.length < 2) return "Usage: mail forward <message_id> <to> --body \"comment\"";
  const msgId = resolveId(parts[0]!);
  const to = parts[1]!;

  const original = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
  const headers = original.data.payload?.headers || [];
  const subject = getHeader(headers, "Subject");
  const fwdSubject = subject.startsWith("Fwd:") ? subject : `Fwd: ${subject}`;
  const originalFrom = getHeader(headers, "From");
  const originalDate = getHeader(headers, "Date");
  const originalBody = extractTextBody(original.data.payload);

  const fwdBody = [
    body || "",
    "",
    "---------- Forwarded message ----------",
    `From: ${originalFrom}`,
    `Date: ${originalDate}`,
    `Subject: ${subject}`,
    "",
    originalBody,
  ].join("\n");

  const raw = createRawEmail(to, fwdSubject, fwdBody);
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  const id = registerIds(res.data.id);
  return `Forwarded to ${to}: "${fwdSubject}" [${id}]`;
}

async function draftMessage(gmail: any, parts: string[]): Promise<string> {
  const body = extractBody(parts);
  if (parts.length < 2) return 'Usage: mail draft <to> <subject> --body "content"';
  const to = parts[0]!;
  const subject = parts.slice(1).join(" ");

  const raw = createRawEmail(to, subject, body || "");
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });

  const id = registerIds(res.data.id);
  return `Draft created: "${subject}" to ${to} [${id}]`;
}

async function listLabels(gmail: any, email: string): Promise<string> {
  const res = await gmail.users.labels.list({ userId: "me" });
  const labels = res.data.labels || [];
  const system = labels.filter((l: any) => l.type === "system").map((l: any) => l.name);
  const user = labels.filter((l: any) => l.type === "user").map((l: any) => l.name);

  const lines = [`Labels \u{2014} ${email}`];
  if (system.length) lines.push(`  System: ${system.join(", ")}`);
  if (user.length) lines.push(`  Custom: ${user.join(", ")}`);
  return lines.join("\n");
}

async function tagMessage(gmail: any, parts: string[]): Promise<string> {
  if (parts.length < 2) return "Usage: mail tag <id> +LABEL or -LABEL\nExamples: mail tag abc123 +STARRED, mail tag abc123 -UNREAD, mail tag abc123 +TRASH";

  const msgId = resolveId(parts[0]!);
  const addLabels: string[] = [];
  const removeLabels: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    const label = parts[i]!;
    if (label.startsWith("+")) addLabels.push(label.slice(1).toUpperCase());
    else if (label.startsWith("-")) removeLabels.push(label.slice(1).toUpperCase());
    else addLabels.push(label.toUpperCase());
  }

  await gmail.users.messages.modify({
    userId: "me",
    id: msgId,
    requestBody: {
      addLabelIds: addLabels.length ? addLabels : undefined,
      removeLabelIds: removeLabels.length ? removeLabels : undefined,
    },
  });

  const changes = [
    ...addLabels.map(l => `+${l}`),
    ...removeLabels.map(l => `-${l}`),
  ].join(", ");
  return `Updated labels: ${changes}`;
}

async function downloadAttachment(gmail: any, parts: string[]): Promise<string> {
  if (parts.length < 2) return "Usage: mail attach <message_id> <attachment_id>";
  const msgId = resolveId(parts[0]!);
  const attachId = parts[1]!;

  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: msgId,
    id: attachId,
  });

  const data = res.data.data;
  if (!data) return "Attachment is empty";

  const size = Buffer.from(data, "base64url").length;
  return `Attachment downloaded (${(size / 1024).toFixed(1)} KB). Base64 data available.`;
}

function createRawEmail(
  to: string,
  subject: string,
  body: string,
  extra?: { inReplyTo?: string; references?: string },
): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];
  if (extra?.inReplyTo) lines.push(`In-Reply-To: ${extra.inReplyTo}`);
  if (extra?.references) lines.push(`References: ${extra.references}`);
  lines.push("", body);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}
