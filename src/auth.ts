import { google } from "googleapis";
import { type OAuth2Client } from "googleapis-common";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes, createHash } from "crypto";

const CREDENTIALS_DIR = join(homedir(), ".google-workspace-mcp", "credentials");
const LEGACY_CREDENTIALS_DIR = join(homedir(), ".google_workspace_mcp", "credentials");
const AUTH_TIMEOUT_MS = 120_000;

const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

interface StoredCredentials {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
  scope: string;
}

// ── PKCE S256 ───────────────────────────────────────────────────────
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ── OAuth client ────────────────────────────────────────────────────
function getClientId(): string {
  const id = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  if (!id) throw new Error("GOOGLE_OAUTH_CLIENT_ID environment variable is required");
  return id;
}

function getClientSecret(): string {
  const secret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (!secret) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET environment variable is required");
  return secret;
}

function createOAuth2Client(redirectUri?: string): OAuth2Client {
  return new google.auth.OAuth2(
    getClientId(),
    getClientSecret(),
    redirectUri || "http://127.0.0.1/oauth2callback",
  );
}

// ── Credential storage ──────────────────────────────────────────────
function credentialPath(email: string): string {
  return join(CREDENTIALS_DIR, `${encodeURIComponent(email)}.json`);
}

interface LegacyCredentials {
  token: string;
  refresh_token: string;
  token_uri: string;
  client_id: string;
  client_secret: string;
  scopes: string[];
  expiry: string;
}

function loadLegacyCredentials(email: string): StoredCredentials | null {
  const path = join(LEGACY_CREDENTIALS_DIR, `${email}.json`);
  if (!existsSync(path)) return null;
  try {
    const legacy = JSON.parse(readFileSync(path, "utf-8")) as LegacyCredentials;
    return {
      access_token: legacy.token,
      refresh_token: legacy.refresh_token,
      expiry_date: new Date(legacy.expiry).getTime(),
      token_type: "Bearer",
      scope: legacy.scopes.join(" "),
    };
  } catch {
    return null;
  }
}

function loadCredentials(email: string): StoredCredentials | null {
  const path = credentialPath(email);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as StoredCredentials;
    } catch { /* fall through */ }
  }
  return loadLegacyCredentials(email);
}

function saveCredentials(email: string, creds: StoredCredentials): void {
  mkdirSync(CREDENTIALS_DIR, { recursive: true });
  writeFileSync(credentialPath(email), JSON.stringify(creds, null, 2));
}

// ── Auth error ──────────────────────────────────────────────────────
export class AuthRequiredError extends Error {
  constructor(
    public email: string,
    public authUrl: string,
  ) {
    super(
      `Authentication required for ${email}.\n` +
      `Open this URL in your browser:\n${authUrl}\n\n` +
      `After authorizing, retry your command.`,
    );
  }
}

// ── Main auth entry point ───────────────────────────────────────────
export async function getAuthenticatedClient(email: string): Promise<OAuth2Client> {
  const stored = loadCredentials(email);

  if (stored) {
    const client = createOAuth2Client();
    client.setCredentials({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
      expiry_date: stored.expiry_date,
      token_type: stored.token_type,
    });

    if (stored.expiry_date && stored.expiry_date < Date.now() + 60_000) {
      try {
        const { credentials } = await client.refreshAccessToken();
        saveCredentials(email, {
          access_token: credentials.access_token!,
          refresh_token: credentials.refresh_token || stored.refresh_token,
          expiry_date: credentials.expiry_date!,
          token_type: credentials.token_type || "Bearer",
          scope: stored.scope,
        });
        client.setCredentials(credentials);
      } catch {
        return startAuthFlow(email);
      }
    }
    return client;
  }

  return startAuthFlow(email);
}

// ── OAuth flow with PKCE + ephemeral port ───────────────────────────
let callbackServer: ReturnType<typeof Bun.serve> | null = null;
let authTimeout: ReturnType<typeof setTimeout> | null = null;

async function startAuthFlow(email: string): Promise<never> {
  const pkce = generatePKCE();

  // Ephemeral port — let OS pick a free port
  const port = await startCallbackServer(email, pkce.verifier);
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const client = createOAuth2Client(redirectUri);
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    login_hint: email,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256" as any,
  });

  // Open browser (cross-platform)
  openBrowser(authUrl);

  throw new AuthRequiredError(email, authUrl);
}

function openBrowser(url: string): void {
  const { exec } = require("child_process");
  const cmds: Record<string, string> = {
    darwin: "open",
    win32: "start",
    linux: "xdg-open",
  };
  const cmd = cmds[process.platform] || "xdg-open";
  exec(`${cmd} "${url}"`);
}

async function startCallbackServer(email: string, codeVerifier: string): Promise<number> {
  if (callbackServer) {
    callbackServer.stop();
    callbackServer = null;
  }
  if (authTimeout) {
    clearTimeout(authTimeout);
    authTimeout = null;
  }

  callbackServer = Bun.serve({
    port: 0, // Ephemeral port
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/oauth2callback") {
        return new Response("Not found", { status: 404 });
      }

      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") || error;
        shutdownServer();
        return new Response(errorPage(desc), {
          headers: { "Content-Type": "text/html" },
        });
      }

      const code = url.searchParams.get("code");
      if (!code) {
        shutdownServer();
        return new Response(errorPage("No authorization code received"), {
          headers: { "Content-Type": "text/html" },
        });
      }

      try {
        const port = callbackServer!.port;
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
        const client = createOAuth2Client(redirectUri);

        // Exchange code with PKCE verifier
        const { tokens } = await client.getToken({
          code,
          codeVerifier,
        });

        // Fetch actual email from userinfo
        client.setCredentials(tokens);
        const oauth2 = google.oauth2({ version: "v2", auth: client });
        const userInfo = await oauth2.userinfo.get();
        const actualEmail = userInfo.data.email || email;

        saveCredentials(actualEmail, {
          access_token: tokens.access_token!,
          refresh_token: tokens.refresh_token!,
          expiry_date: tokens.expiry_date!,
          token_type: tokens.token_type || "Bearer",
          scope: tokens.scope || SCOPES.join(" "),
        });

        shutdownServer();
        return new Response(successPage(actualEmail), {
          headers: { "Content-Type": "text/html" },
        });
      } catch (err) {
        shutdownServer();
        return new Response(errorPage(String(err)), {
          headers: { "Content-Type": "text/html" },
        });
      }
    },
  });

  // Auto-shutdown after timeout
  authTimeout = setTimeout(() => {
    shutdownServer();
  }, AUTH_TIMEOUT_MS);

  const assignedPort = callbackServer!.port;
  if (!assignedPort) throw new Error("Failed to bind callback server to a port");
  return assignedPort;
}

function shutdownServer(): void {
  setTimeout(() => {
    callbackServer?.stop();
    callbackServer = null;
    if (authTimeout) {
      clearTimeout(authTimeout);
      authTimeout = null;
    }
  }, 1500);
}

// ── HTML pages ──────────────────────────────────────────────────────
function successPage(userEmail: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorization Successful</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
      color: #e2e8f0;
    }
    .card {
      text-align: center;
      padding: 3rem 4rem;
      background: rgba(30, 41, 59, 0.7);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 1.5rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      max-width: 480px;
      animation: fadeIn 0.5s ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .check {
      width: 80px; height: 80px; margin: 0 auto 1.5rem;
      border-radius: 50%;
      background: linear-gradient(135deg, #22c55e, #16a34a);
      display: flex; align-items: center; justify-content: center;
      animation: pop 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    }
    @keyframes pop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
    .check svg { width: 40px; height: 40px; }
    .check svg path { stroke-dasharray: 50; stroke-dashoffset: 50; animation: draw 0.5s 0.3s forwards; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
    .email { color: #818cf8; font-size: 0.95rem; margin-bottom: 1.5rem; }
    .countdown {
      font-size: 0.85rem; color: #64748b;
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    }
    .bar-track {
      width: 120px; height: 3px; background: #334155; border-radius: 2px; overflow: hidden;
    }
    .bar-fill {
      height: 100%; width: 100%; background: #6366f1; border-radius: 2px;
      animation: shrink 5s linear forwards;
    }
    @keyframes shrink { to { width: 0; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>Authorization successful</h1>
    <p class="email">${userEmail}</p>
    <div class="countdown">
      <span>Closing in <span id="sec">5</span>s</span>
      <div class="bar-track"><div class="bar-fill"></div></div>
    </div>
  </div>
  <script>
    let s = 5;
    const el = document.getElementById('sec');
    const t = setInterval(() => { s--; el.textContent = s; if (s <= 0) { clearInterval(t); window.close(); } }, 1000);
  </script>
</body>
</html>`;
}

function errorPage(message: string): string {
  const safeMsg = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorization Failed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #1a0a0a 0%, #2d1515 50%, #1a0a0a 100%);
      color: #e2e8f0;
    }
    .card {
      text-align: center;
      padding: 3rem 4rem;
      background: rgba(45, 21, 21, 0.7);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: 1.5rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      max-width: 520px;
      animation: fadeIn 0.5s ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .icon {
      width: 80px; height: 80px; margin: 0 auto 1.5rem;
      border-radius: 50%;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      display: flex; align-items: center; justify-content: center;
      font-size: 2.5rem;
      animation: shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97);
    }
    @keyframes shake { 10%, 90% { transform: translateX(-2px); } 20%, 80% { transform: translateX(4px); } 30%, 50%, 70% { transform: translateX(-6px); } 40%, 60% { transform: translateX(6px); } }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem; color: #fca5a5; }
    .message {
      font-size: 0.9rem; color: #94a3b8; line-height: 1.6;
      background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 0.75rem;
      margin-bottom: 1.5rem; text-align: left; word-break: break-word;
    }
    .hint { font-size: 0.85rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">\u2716</div>
    <h1>Authorization failed</h1>
    <div class="message">${safeMsg}</div>
    <p class="hint">Retry your command to start a new authorization flow.</p>
  </div>
</body>
</html>`;
}

// ── Default email ───────────────────────────────────────────────────
export function getDefaultEmail(): string {
  const env = process.env["GOOGLE_DEFAULT_EMAIL"];
  if (env) return env;
  if (existsSync(CREDENTIALS_DIR)) {
    const files = readdirSync(CREDENTIALS_DIR);
    const first = files.find(f => f.endsWith(".json"));
    if (first) return decodeURIComponent(first.replace(".json", ""));
  }
  throw new Error("No default email. Set GOOGLE_DEFAULT_EMAIL or use --as <email>");
}
