# google-workspace-mcp

A single-tool MCP server for Google Calendar, Gmail & Drive — designed for LLM context efficiency.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple)](https://modelcontextprotocol.io)

## Why?

Most Google Workspace MCP servers expose **30-120 separate tools**, each with verbose descriptions that consume thousands of tokens from your LLM context window. This server takes a different approach:

- **1 tool, 1 parameter** — a CLI-like interface using natural commands
- **~15 lines of description** instead of ~3,000 tokens
- **Compact output** — short IDs, relative dates, dense formatting
- **Multi-account** — switch between Google accounts with `--as`
- **LLM-tolerant** — aliases in English and French, flexible date parsing, intelligent error messages

## Quick Start

### 1. Prerequisites

- [Bun](https://bun.sh) runtime
- Google Cloud project with Calendar, Gmail, and Drive APIs enabled
- OAuth 2.0 Desktop Application credentials

### 2. Install

```bash
git clone https://github.com/Remenby31/google-workspace-mcp.git
cd google-workspace-mcp
bun install
```

### 3. Configure

Add to your MCP client configuration (e.g. `~/.mcp.json`):

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

### 4. Authenticate

The first time you use any command, a browser window opens for Google OAuth. Tokens are stored locally at `~/.google-workspace-mcp/credentials/`.

## Commands

### Calendar

```
google cal                              → Events for today + 3 days
google cal tomorrow                     → Tomorrow's events
google cal next week                    → Next week's events
google cal search <query>               → Search events by keyword
google cal detail <id>                  → Full details (attendees, meet link)
google cal create <title> <start> <end> → Create event (--meet --invite a@b.com)
google cal update <id> --title "..."    → Update event
google cal delete <id>                  → Delete event
google cal rsvp <id> yes|no|maybe       → RSVP to invitation
google cal busy <date>                  → Free/busy slots
google cal calendars                    → List all calendars
```

### Gmail

```
google mail                             → Last 10 unread emails
google mail search <query>              → Search (supports Gmail operators)
google mail read <id>                   → Read full message
google mail thread <id>                 → Read full conversation
google mail send <to> <subject> --body  → Send email
google mail reply <id> --body "..."     → Reply to message
google mail draft <to> <subject> --body → Create draft
google mail labels                      → List labels
google mail tag <id> +/-LABEL           → Add/remove label
```

### Drive

```
google drive search <query>             → Search files
google drive ls [folder_id]             → List folder contents
google drive read <id>                  → Read file content
google drive info <id>                  → Metadata & permissions
google drive share <id> <email> [role]  → Share file
google drive link <id>                  → Shareable link
google drive mkdir <name>               → Create folder
google drive cp <id> [name]             → Copy file
```

### Options

```
--as <email>                            → Use specific Google account
```

## Output Format

Compact, scannable output optimized for LLM token efficiency:

```
Jun 22 (Mon) — user@company.com
  [a3f2c1] 09:30-10:00  Weekly Standup              📹 meet.google.com/abc-defg-hij
  [b7e4d9] 10:00-10:30  Engineering Sync            📹 meet.google.com/xyz-uvwx-rst
  [——————] all-day       Office
```

```
Inbox — user@company.com (3 unread)
  [f8c2a1] Jun 20 14:32  alice@company.com       Re: Deploy pipeline         ★
  [d4e7b3] Jun 19 09:15  bob@company.com         PR Review #432              📎
```

**Short IDs** — 6-character IDs like `[a3f2c1]` that map to full Google IDs within a session.

**Relative dates** — `today`, `tomorrow`, `Mon`, `Jun 25` instead of ISO timestamps.

## Multi-Account

Connect multiple Google accounts and switch between them:

```
google cal                              → Uses GOOGLE_DEFAULT_EMAIL
google cal --as work@company.com        → Uses work account
google mail --as personal@gmail.com     → Uses personal account
```

Each account authenticates independently. Tokens are stored per-email.

## Error Handling

Errors include the correct command syntax and an example:

```
> google cal create "Meeting" tomorrow
Missing end time. Usage: cal create <title> <start> <end>
Example: cal create "Meeting" "tomorrow 14:00" "tomorrow 15:00"
```

```
> google mail read
Missing message ID. Run 'mail' or 'mail search <query>' first to get IDs.
```

## Architecture

```
src/
├── index.ts        MCP server entry — single tool definition
├── commands.ts     Command parser, aliases, dispatch
├── auth.ts         OAuth2 flow, token storage, multi-account
├── calendar.ts     Google Calendar API handlers
├── gmail.ts        Gmail API handlers
├── drive.ts        Google Drive API handlers
└── format.ts       Short IDs, date formatting, output helpers
```

**Dependencies**: Only 2 runtime deps — `@modelcontextprotocol/sdk` and `googleapis`.

## Google Cloud Setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable APIs: Calendar, Gmail, Drive
3. Configure OAuth consent screen (External, publish for no token expiry)
4. Create OAuth credentials: Desktop Application
5. Copy Client ID and Secret to your MCP config

## License

[MIT](LICENSE)
