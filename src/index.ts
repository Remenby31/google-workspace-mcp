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

function registerTool(server: McpServer) {
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
}

const httpPort = process.argv.includes("--http")
  ? parseInt(process.env["HTTP_PORT"] || "3003", 10)
  : process.env["HTTP_PORT"]
    ? parseInt(process.env["HTTP_PORT"], 10)
    : null;

if (httpPort) {
  // Stateless HTTP: create a fresh server+transport per request
  Bun.serve({
    port: httpPort,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        return Response.json({ status: "ok", name: "google-workspace-mcp" });
      }

      if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
        const apiKey = process.env["MCP_API_KEY"];
        if (apiKey) {
          const provided = req.headers.get("authorization")?.replace("Bearer ", "")
            || url.searchParams.get("key");
          if (provided !== apiKey) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }
        }
        const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = new McpServer({ name: "google", version: "0.1.0" });
        registerTool(server);
        await server.connect(transport);
        return transport.handleRequest(req);
      }

      if (url.pathname === "/deploy" && req.method === "POST") {
        const secret = process.env["DEPLOY_SECRET"];
        const auth = req.headers.get("authorization");
        if (!secret || auth !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { exec } = require("child_process");
        exec("git pull && sudo systemctl restart google-workspace-mcp", { cwd: process.cwd() });
        return Response.json({ status: "deploying" });
      }

      if (url.pathname === "/" || url.pathname === "") {
        return new Response(landingPage(), { headers: { "Content-Type": "text/html" } });
      }

      return new Response("Not found", { status: 404 });
    },
  } as any);

  console.error(`google-workspace-mcp listening on http://0.0.0.0:${httpPort}/mcp`);
} else {
  const server = new McpServer({ name: "google", version: "0.1.0" });
  registerTool(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function landingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>google-workspace-mcp</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0}
    .card{max-width:600px;padding:3rem;text-align:center}
    h1{font-size:2rem;font-weight:700;margin-bottom:.5rem}
    .sub{color:#94a3b8;margin-bottom:2rem;font-size:1.1rem}
    .services{display:flex;gap:1.5rem;justify-content:center;margin-bottom:2rem}
    .svc{background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);border-radius:1rem;padding:1.25rem 1.5rem;flex:1}
    .svc .icon{font-size:2rem;margin-bottom:.5rem}
    .svc .name{font-weight:600;font-size:.95rem}
    .badge{display:inline-flex;gap:.75rem;margin-bottom:2rem}
    .badge span{background:#1e293b;border:1px solid #334155;border-radius:2rem;padding:.35rem .9rem;font-size:.8rem;color:#94a3b8}
    .badge span.green{border-color:#22c55e40;color:#4ade80}
    .endpoint{background:#1e293b;border:1px solid #334155;border-radius:.75rem;padding:1rem;font-family:'SF Mono',monospace;font-size:.85rem;color:#818cf8;margin-bottom:1.5rem}
    a{color:#6366f1;text-decoration:none}
    a:hover{text-decoration:underline}
    .footer{color:#475569;font-size:.8rem}
  </style>
</head>
<body>
  <div class="card">
    <h1>google-workspace-mcp</h1>
    <p class="sub">One MCP tool for Google Workspace \u2014 built for LLM context efficiency</p>
    <div class="services">
      <div class="svc"><div class="icon">\u{1F4C5}</div><div class="name">Calendar</div></div>
      <div class="svc"><div class="icon">\u{1F4E7}</div><div class="name">Gmail</div></div>
      <div class="svc"><div class="icon">\u{1F4C1}</div><div class="name">Drive</div></div>
    </div>
    <div class="badge">
      <span class="green">\u{25CF} Online</span>
      <span>MCP Protocol</span>
      <span>v0.1.0</span>
    </div>
    <div class="endpoint">/mcp</div>
    <p class="footer"><a href="https://github.com/Remenby31/google-workspace-mcp">GitHub</a> \u{2022} MIT License</p>
  </div>
</body>
</html>`;
}
