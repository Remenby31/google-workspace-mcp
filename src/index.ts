#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { executeCommand } from "./commands.ts";
import { AuthRequiredError } from "./auth.ts";

const server = new McpServer({
  name: "google",
  version: "0.1.0",
});

server.tool(
  "google",
  `Google Workspace CLI. Commands:
  cal [date]              Calendar events (default: today+3d)
  cal detail <id>         Event details with attendees & meet
  cal create/update/delete/rsvp  Manage events
  cal search <query>      Search events
  mail                    Last 10 unread
  mail search <query>     Search (gmail operators supported)
  mail read/thread <id>   Read message or thread
  mail send/reply/draft   Compose emails
  mail tag <id> +/-LABEL  Manage labels
  drive search <query>    Search files
  drive ls [folder]       List folder contents
  drive read <id>         Read file content
  drive share/link/mkdir/cp  Manage files
  --as <email>            Use specific Google account`,
  { command: z.string().describe("Command to execute (e.g. 'cal', 'mail search from:alice')") },
  async ({ command }) => {
    try {
      const result = await executeCommand(command);
      return { content: [{ type: "text", text: result }] };
    } catch (err: any) {
      if (err instanceof AuthRequiredError) {
        return {
          content: [{ type: "text", text: err.message }],
          isError: true,
        };
      }
      const message = err?.message || String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
