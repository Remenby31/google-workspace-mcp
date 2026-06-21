<p align="center">
  <h1 align="center">google-workspace-mcp</h1>
  <p align="center">
    One MCP tool for Google Calendar, Gmail & Drive — built for LLM context efficiency.
    <br />
    <a href="#-quick-start">Quick Start</a> · <a href="#-commands">Commands</a> · <a href="#-output-format">Output</a> · <a href="#-security">Security</a>
  </p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun_1.3-f9f1e1?logo=bun" alt="Bun" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/protocol-MCP-7c3aed" alt="MCP" /></a>
  <a href="https://github.com/Remenby31/google-workspace-mcp/actions"><img src="https://img.shields.io/badge/build-passing-brightgreen" alt="Build" /></a>
  <a href="https://github.com/Remenby31/google-workspace-mcp"><img src="https://img.shields.io/badge/version-0.1.0-orange" alt="Version" /></a>
</p>

---

## Why?

Most Google Workspace MCP servers register **30–120 separate tools**, each with verbose parameter descriptions that eat thousands of tokens from your LLM context window.

This server takes a different approach:

| | Typical MCP server | google-workspace-mcp |
|---|---|---|
| Tools registered | 30–120 | **1** |
| Tool descriptions | ~3,000 tokens | **~150 tokens** |
| Context overhead | High | **Minimal** |
| Output format | Verbose JSON-like | **Compact, scannable** |
| Multi-account | Limited | **Built-in (`--as`)** |

**One tool. One parameter. Full Google Workspace access.**

## ⚡ Quick Start

```bash
git clone https://github.com/Remenby31/google-workspace-mcp.git
cd google-workspace-mcp
bun install
bun run setup
```

The interactive wizard handles everything:

1. Asks for your Google Cloud OAuth credentials
2. Writes `~/.mcp.json` config automatically
3. Opens your browser for authorization (OAuth 2.1 + PKCE)
4. Verifies the connection by fetching your calendar

> **Prerequisites:** [Bun](https://bun.sh) ≥ 1.0 (`curl -fsSL https://bun.sh/install | bash`) and a [Google Cloud project](#-google-cloud-setup) with OAuth credentials.

<details>
<summary><strong>Manual configuration</strong></summary>

Add to `~/.mcp.json` (or your MCP client's config):

```json
{
  "mcpServers": {
    "google": {
      "command": "bun",
      "args": ["run", "/path/to/google-workspace-mcp/src/index.ts"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_OAUTH_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_DEFAULT_EMAIL": "you@gmail.com"
      }
    }
  }
}
```

| Variable | Description |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_DEFAULT_EMAIL` | Default Google account (optional, auto-detected from stored credentials) |

</details>

<details>
<summary><strong>Client-specific setup: Claude Code / VS Code / Cursor</strong></summary>

**Claude Code CLI** — uses `~/.mcp.json` (configured by `bun run setup`)

**VS Code / Cursor** — add to `.vscode/mcp.json`:
```json
{
  "servers": {
    "google": {
      "command": "bun",
      "args": ["run", "/path/to/google-workspace-mcp/src/index.ts"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_ID": "...",
        "GOOGLE_OAUTH_CLIENT_SECRET": "...",
        "GOOGLE_DEFAULT_EMAIL": "..."
      }
    }
  }
}
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows), same structure as above inside `"mcpServers"`.

</details>

## 🧰 Commands

### 📅 Calendar

| Command | Description |
|---|---|
| `cal` | Events for today + 3 days |
| `cal <date\|range>` | Events for a date (`tomorrow`, `next week`, `jun 25`, `jun 25-28`) |
| `cal search <query>` | Search events by keyword |
| `cal detail <id>` | Full details — attendees, Meet link, description |
| `cal create <title> <start> <end>` | Create event. Options: `--meet` `--invite a@b.com` |
| `cal update <id> [flags]` | Update: `--title` `--start` `--end` `--location` |
| `cal delete <id>` | Delete event |
| `cal rsvp <id> <yes\|no\|maybe>` | RSVP to invitation |
| `cal busy <date\|range>` | Free/busy slots |
| `cal calendars` | List all calendars |

### 📧 Gmail

| Command | Description |
|---|---|
| `mail` | Last 10 unread emails |
| `mail search <query>` | Search with [Gmail operators](https://support.google.com/mail/answer/7190?hl=en) (`from:`, `is:`, `has:`, `after:`) |
| `mail read <id>` | Read full message content |
| `mail thread <id>` | Read entire conversation thread |
| `mail send <to> <subject> --body "..."` | Send email |
| `mail reply <id> --body "..."` | Reply to message |
| `mail draft <to> <subject> --body "..."` | Create draft |
| `mail labels` | List all labels |
| `mail tag <id> +/-LABEL` | Add/remove label (`+STARRED`, `-UNREAD`, `+TRASH`) |
| `mail attach <msg_id> <attachment_id>` | Download attachment |

### 📁 Drive

| Command | Description |
|---|---|
| `drive search <query>` | Search files by name or content |
| `drive ls [folder_id]` | List folder contents (default: root) |
| `drive read <id>` | Read file content (Docs, Sheets → text/CSV, PDFs, text files) |
| `drive info <id>` | Metadata, permissions, sharing status |
| `drive share <id> <email> [role]` | Share file (`reader` \| `commenter` \| `writer`) |
| `drive link <id>` | Get shareable link |
| `drive mkdir <name>` | Create folder |
| `drive cp <id> [name]` | Copy file |

### 🌐 Options

| Option | Description |
|---|---|
| `--as <email>` | Use a specific Google account instead of default |
| `help` | Show all commands |

## 📋 Output Format

Compact, scannable, token-efficient:

**Calendar:**
```
Jun 22 (Mon) — user@company.com
  [a3f2c1] 09:30-10:00  Weekly Standup              📹 meet.google.com/abc-defg-hij
  [b7e4d9] 10:00-10:30  Engineering Sync            📹 meet.google.com/xyz-uvwx-rst
  [——————] all-day       Office
```

**Gmail:**
```
Inbox — user@company.com (3 unread)
  [f8c2a1] Jun 20 14:32  alice@company.com       Re: Deploy pipeline         ★
  [d4e7b3] Jun 19 09:15  bob@company.com         PR Review #432              📎
  [a1b2c3] Jun 18 22:01  noreply@github.com      [proj] CI failed
```

**Drive:**
```
My Drive — user@gmail.com
  📁 [d1e2f3] Projects/          modified Jun 20
  📄 [a4b5c6] Budget 2026.xlsx   12.3 KB  modified Jun 18
  📝 [g7h8i9] Meeting Notes      Google Doc  modified Jun 15
```

<details>
<summary><strong>Design principles</strong></summary>

- **Short IDs** — 6-character codes like `[a3f2c1]` mapped to full Google IDs within each session. Use them in follow-up commands: `cal detail a3f2c1`
- **Relative dates** — `today`, `tomorrow`, `Mon`, `Jun 25` instead of ISO timestamps
- **Dense layout** — one line per item, key info front-loaded, icons for quick scanning
- **Truncation** — long content truncated with `...` to avoid flooding the context
- **No boilerplate** — no "Successfully retrieved 4 events from calendar 'primary' for user@..." wrappers

</details>

## 🔄 Multi-Account

Connect multiple Google accounts and switch freely:

```
google cal                              → default account (GOOGLE_DEFAULT_EMAIL)
google cal --as work@company.com        → work calendar
google mail --as personal@gmail.com     → personal inbox
```

Each account authenticates independently on first use. Tokens are stored per-email in `~/.google-workspace-mcp/credentials/`.

## 🛡️ Error Handling

Errors always include correct syntax and an example — LLMs can self-correct:

```
> cal create "Meeting" tomorrow
Missing end time. Usage: cal create <title> <start> <end>
Example: cal create "Meeting" "tomorrow 14:00" "tomorrow 15:00"

> mail read
Missing message ID. Run 'mail' or 'mail search <query>' first to get IDs.

> blabla
Unknown command "blabla". Available: cal, mail, drive, help
```

<details>
<summary><strong>LLM tolerance features</strong></summary>

- **Aliases** — `calendar` / `agenda` / `rdv` → `cal`, `gmail` / `email` / `inbox` → `mail`
- **French support** — `demain`, `chercher`, `envoyer`, `supprimer`, `lundi`
- **Flexible dates** — `tomorrow`, `next monday`, `jun 25`, `25/06`, `2026-06-25`
- **RSVP tolerance** — `yes` / `oui` / `ok` / `accepted` all work
- **Fuzzy actions** — `read` / `get` / `show` / `view` / `open` all resolve to the same action

</details>

## 🔒 Security

| Feature | Implementation |
|---|---|
| OAuth 2.1 + PKCE S256 | Authorization code flow with proof key ([RFC 7636](https://tools.ietf.org/html/rfc7636)) |
| Ephemeral ports | Callback server binds to OS-assigned free port |
| Loopback only | `127.0.0.1` binding, no external access ([RFC 8252](https://datatracker.ietf.org/doc/rfc8252/)) |
| Auto-shutdown | Callback server stops after auth or 2-minute timeout |
| Local storage | Tokens in `~/.google-workspace-mcp/credentials/`, never transmitted |
| No telemetry | Zero tracking, fully auditable source |

## 🏗️ Architecture

```
src/
├── index.ts        MCP server — single tool definition (~50 lines)
├── commands.ts     Command parser, aliases, dispatch
├── auth.ts         OAuth 2.1 + PKCE, token storage, multi-account
├── calendar.ts     Google Calendar API (10 commands)
├── gmail.ts        Gmail API (10 commands)
├── drive.ts        Google Drive API (8 commands)
├── format.ts       Short IDs, relative dates, output formatting
└── setup.ts        Interactive setup wizard
```

**2 runtime dependencies**: [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) + [`googleapis`](https://www.npmjs.com/package/googleapis)

## ☁️ Google Cloud Setup

<details>
<summary><strong>Step-by-step guide</strong></summary>

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a new project
2. Navigate to **APIs & Services → Library** and enable:
   - Google Calendar API
   - Gmail API
   - Google Drive API
3. Go to **APIs & Services → OAuth consent screen**:
   - Select **External** user type
   - Fill in app name and email
   - **Publish** the app (avoids 7-day token expiry in test mode)
4. Go to **APIs & Services → Credentials**:
   - Click **Create Credentials → OAuth client ID**
   - Select **Desktop application**
   - Copy the **Client ID** and **Client Secret**
5. Run `bun run setup` and paste your credentials

</details>

## 🤝 Contributing

Contributions welcome! The codebase is small (~1,200 lines) and straightforward.

```bash
git clone https://github.com/Remenby31/google-workspace-mcp.git
cd google-workspace-mcp
bun install
bun run typecheck    # type checking
bun run test         # run test suite
```

## 📄 License

[MIT](LICENSE) — use it however you want.
