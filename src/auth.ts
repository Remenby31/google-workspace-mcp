import { google } from "googleapis";
import { type OAuth2Client } from "googleapis-common";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CREDENTIALS_DIR = join(homedir(), ".google-workspace-mcp", "credentials");
const CALLBACK_PORT = 8321;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/oauth2callback`;

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

function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(getClientId(), getClientSecret(), REDIRECT_URI);
}

function credentialPath(email: string): string {
  return join(CREDENTIALS_DIR, `${encodeURIComponent(email)}.json`);
}

function loadCredentials(email: string): StoredCredentials | null {
  const path = credentialPath(email);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StoredCredentials;
  } catch {
    return null;
  }
}

function saveCredentials(email: string, creds: StoredCredentials): void {
  mkdirSync(CREDENTIALS_DIR, { recursive: true });
  writeFileSync(credentialPath(email), JSON.stringify(creds, null, 2));
}

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

export async function getAuthenticatedClient(email: string): Promise<OAuth2Client> {
  const client = createOAuth2Client();
  const stored = loadCredentials(email);

  if (stored) {
    client.setCredentials({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
      expiry_date: stored.expiry_date,
      token_type: stored.token_type,
    });

    if (stored.expiry_date && stored.expiry_date < Date.now() + 60000) {
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

async function startAuthFlow(email: string): Promise<never> {
  const client = createOAuth2Client();
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    login_hint: email,
  });

  // Start callback server in background
  startCallbackServer(email);

  // Open browser
  const { exec } = await import("child_process");
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${cmd} "${authUrl}"`);

  throw new AuthRequiredError(email, authUrl);
}

let callbackServer: ReturnType<typeof Bun.serve> | null = null;

function startCallbackServer(email: string): void {
  if (callbackServer) return;

  callbackServer = Bun.serve({
    port: CALLBACK_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/oauth2callback") {
        return new Response("Not found", { status: 404 });
      }

      const code = url.searchParams.get("code");
      if (!code) {
        return new Response("Missing authorization code", { status: 400 });
      }

      try {
        const client = createOAuth2Client();
        const { tokens } = await client.getToken(code);

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

        // Shut down callback server after short delay
        setTimeout(() => {
          callbackServer?.stop();
          callbackServer = null;
        }, 1000);

        return new Response(
          `<html><body><h2>Authorization successful for ${actualEmail}</h2>` +
          `<p>You can close this tab and retry your command.</p></body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      } catch (err) {
        return new Response(`Authorization failed: ${err}`, { status: 500 });
      }
    },
  });
}

export function getDefaultEmail(): string {
  const env = process.env["GOOGLE_DEFAULT_EMAIL"];
  if (env) return env;
  // Try to find any stored credential
  if (existsSync(CREDENTIALS_DIR)) {
    const files = require("fs").readdirSync(CREDENTIALS_DIR) as string[];
    const first = files.find((f: string) => f.endsWith(".json"));
    if (first) return decodeURIComponent(first.replace(".json", ""));
  }
  throw new Error("No default email. Set GOOGLE_DEFAULT_EMAIL or use --as <email>");
}
