#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { executeCommand } from "./commands.ts";
import { AuthRequiredError } from "./auth.ts";

const TOOL_DESCRIPTION = `Google Workspace CLI. Commands:
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
  --as <email>            Use specific Google account`;

const server = new McpServer({
  name: "google",
  version: "0.1.0",
});

server.tool(
  "google",
  TOOL_DESCRIPTION,
  { command: z.string().describe("Command to execute (e.g. 'cal', 'mail search from:alice')") },
  async ({ command }) => {
    try {
      const result = await executeCommand(command);
      return { content: [{ type: "text", text: result }] };
    } catch (err: any) {
      if (err instanceof AuthRequiredError) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
      return { content: [{ type: "text", text: `Error: ${err?.message || err}` }], isError: true };
    }
  },
);

const httpPort = process.argv.includes("--http")
  ? parseInt(process.env["HTTP_PORT"] || "3003", 10)
  : process.env["HTTP_PORT"]
    ? parseInt(process.env["HTTP_PORT"], 10)
    : null;

if (httpPort) {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  Bun.serve({
    port: httpPort,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", name: "google-workspace-mcp" });
      }
      if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
        return transport.handleRequest(req);
      }
      return new Response("Not found", { status: 404 });
    },
  } as any);

  await server.connect(transport);
  console.error(`google-workspace-mcp listening on http://0.0.0.0:${httpPort}/mcp`);
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
