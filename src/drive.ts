import { google } from "googleapis";
import type { OAuth2Client } from "googleapis-common";
import { ACTION_ALIASES } from "./commands.ts";
import { registerIds, resolveId, truncate } from "./format.ts";

const MIME_ICONS: Record<string, string> = {
  "application/vnd.google-apps.folder": "\u{1F4C1}",
  "application/vnd.google-apps.document": "\u{1F4DD}",
  "application/vnd.google-apps.spreadsheet": "\u{1F4CA}",
  "application/vnd.google-apps.presentation": "\u{1F3AC}",
  "application/pdf": "\u{1F4D1}",
  "image/": "\u{1F5BC}",
  "video/": "\u{1F3A5}",
};

function getMimeIcon(mime: string): string {
  for (const [key, icon] of Object.entries(MIME_ICONS)) {
    if (mime.startsWith(key)) return icon;
  }
  return "\u{1F4C4}";
}

function formatSize(bytes: string | undefined): string {
  if (!bytes) return "";
  const n = parseInt(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileLine(file: any): string {
  const id = registerIds(file.id);
  const icon = getMimeIcon(file.mimeType || "");
  const name = file.name || "(unnamed)";
  const isFolder = file.mimeType === "application/vnd.google-apps.folder";
  const nameStr = isFolder ? `${name}/` : name;
  const size = !isFolder && file.size ? `  ${formatSize(file.size)}` : "";
  const modified = file.modifiedTime ? `  modified ${file.modifiedTime.slice(0, 10)}` : "";

  // Google native types
  const googleTypes: Record<string, string> = {
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.google-apps.spreadsheet": "Google Sheet",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.form": "Google Form",
  };
  const typeName = googleTypes[file.mimeType] || "";
  const typeStr = typeName ? `  ${typeName}` : size;

  return `  ${icon} [${id}] ${nameStr}${typeStr}${modified}`;
}

export async function handleDrive(auth: OAuth2Client, email: string, parts: string[]): Promise<string> {
  const drive = google.drive({ version: "v3", auth });
  const rawAction = parts[0]?.toLowerCase() || "";
  const action = ACTION_ALIASES[rawAction] || rawAction;

  if (!rawAction) return "Usage: drive <search|ls|read|info|share|link|mkdir|cp>";

  switch (action) {
    case "search": return searchFiles(drive, email, parts.slice(1));
    case "list": return listFolder(drive, email, parts.slice(1));
    case "read": return readFile(drive, parts.slice(1));
    case "info": return fileInfo(drive, parts.slice(1));
    case "share": return shareFile(drive, parts.slice(1));
    case "link": return shareableLink(drive, parts.slice(1));
    case "mkdir": return createFolder(drive, parts.slice(1));
    case "cp": return copyFile(drive, parts.slice(1));
    default:
      return `Unknown drive action "${rawAction}". Available: search, ls, read, info, share, link, mkdir, cp`;
  }
}

async function searchFiles(drive: any, email: string, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing query. Usage: drive search <query>";
  const query = parts.join(" ");

  const res = await drive.files.list({
    q: `fullText contains '${query.replace(/'/g, "\\'")}'`,
    pageSize: 15,
    fields: "files(id,name,mimeType,size,modifiedTime)",
    spaces: "drive",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  const files = res.data.files || [];
  if (files.length === 0) return `No files matching "${query}"`;

  const lines = [`Search: "${query}" \u{2014} ${files.length} results`];
  for (const f of files) lines.push(formatFileLine(f));
  return lines.join("\n");
}

async function listFolder(drive: any, email: string, parts: string[]): Promise<string> {
  const folderId = parts.length > 0 ? resolveId(parts[0]!) : "root";
  const folderName = folderId === "root" ? "My Drive" : folderId;

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    pageSize: 50,
    fields: "files(id,name,mimeType,size,modifiedTime)",
    orderBy: "folder,name",
    spaces: "drive",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  const files = res.data.files || [];
  if (files.length === 0) return `Empty folder \u{2014} ${folderName}`;

  const lines = [`${folderName} \u{2014} ${email}`];
  for (const f of files) lines.push(formatFileLine(f));
  return lines.join("\n");
}

async function readFile(drive: any, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing file ID. Run 'drive search' or 'drive ls' first.";
  const fileId = resolveId(parts[0]!);

  // Get file metadata first
  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size",
    supportsAllDrives: true,
  });

  const mime = meta.data.mimeType;
  const name = meta.data.name;

  // Google native types — export as text
  const exportMap: Record<string, { mime: string; label: string }> = {
    "application/vnd.google-apps.document": { mime: "text/plain", label: "Google Doc" },
    "application/vnd.google-apps.spreadsheet": { mime: "text/csv", label: "Google Sheet" },
    "application/vnd.google-apps.presentation": { mime: "text/plain", label: "Google Slides" },
  };

  const exportInfo = exportMap[mime];
  let content: string;

  if (exportInfo) {
    const res = await drive.files.export({ fileId, mimeType: exportInfo.mime }, { responseType: "text" });
    content = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return `${name} (${exportInfo.label}) [${registerIds(fileId)}]\n---\n${truncate(content, 5000)}`;
  }

  // Binary/text files — download
  try {
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    content = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return `${name} [${registerIds(fileId)}]\n---\n${truncate(content, 5000)}`;
  } catch {
    return `Cannot read "${name}" (${mime}). File may be binary — use 'drive info' for metadata.`;
  }
}

async function fileInfo(drive: any, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing file ID. Usage: drive info <id>";
  const fileId = resolveId(parts[0]!);

  const res = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size,createdTime,modifiedTime,owners,permissions,webViewLink,sharingUser",
    supportsAllDrives: true,
  });

  const f = res.data;
  const id = registerIds(f.id);
  const lines: string[] = [];
  lines.push(`${f.name} [${id}]`);
  lines.push(`  Type: ${f.mimeType}`);
  if (f.size) lines.push(`  Size: ${formatSize(f.size)}`);
  if (f.createdTime) lines.push(`  Created: ${f.createdTime.slice(0, 10)}`);
  if (f.modifiedTime) lines.push(`  Modified: ${f.modifiedTime.slice(0, 10)}`);
  if (f.owners?.length) lines.push(`  Owner: ${f.owners.map((o: any) => o.emailAddress).join(", ")}`);
  if (f.webViewLink) lines.push(`  Link: ${f.webViewLink}`);

  if (f.permissions?.length) {
    lines.push("  Permissions:");
    for (const p of f.permissions) {
      const who = p.emailAddress || p.type || "unknown";
      lines.push(`    ${who}: ${p.role}`);
    }
  }

  return lines.join("\n");
}

async function shareFile(drive: any, parts: string[]): Promise<string> {
  if (parts.length < 2) return "Usage: drive share <id> <email> [reader|commenter|writer]";
  const fileId = resolveId(parts[0]!);
  const shareEmail = parts[1]!;
  const role = parts[2] || "reader";

  if (!["reader", "commenter", "writer"].includes(role)) {
    return `Invalid role "${role}". Use: reader, commenter, writer`;
  }

  await drive.permissions.create({
    fileId,
    requestBody: { type: "user", role, emailAddress: shareEmail },
    supportsAllDrives: true,
  });

  return `Shared with ${shareEmail} as ${role}`;
}

async function shareableLink(drive: any, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing file ID. Usage: drive link <id>";
  const fileId = resolveId(parts[0]!);

  const res = await drive.files.get({
    fileId,
    fields: "webViewLink,webContentLink",
    supportsAllDrives: true,
  });

  return res.data.webViewLink || res.data.webContentLink || "No shareable link available";
}

async function createFolder(drive: any, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing folder name. Usage: drive mkdir <name>";
  const name = parts.join(" ");

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id,name",
  });

  const id = registerIds(res.data.id);
  return `Created folder: ${name} [${id}]`;
}

async function copyFile(drive: any, parts: string[]): Promise<string> {
  if (parts.length === 0) return "Missing file ID. Usage: drive cp <id> [new_name]";
  const fileId = resolveId(parts[0]!);
  const newName = parts.length > 1 ? parts.slice(1).join(" ") : undefined;

  const body: any = {};
  if (newName) body.name = newName;

  const res = await drive.files.copy({
    fileId,
    requestBody: body,
    supportsAllDrives: true,
    fields: "id,name",
  });

  const id = registerIds(res.data.id);
  return `Copied: ${res.data.name} [${id}]`;
}
