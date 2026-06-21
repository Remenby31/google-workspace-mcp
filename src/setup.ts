#!/usr/bin/env bun
/**
 * Interactive setup wizard for google-workspace-mcp.
 * Run: bun run src/setup.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function log(msg: string) { console.log(msg); }
function step(n: number, total: number, msg: string) {
  log(`\n${DIM}[${n}/${total}]${RESET} ${BOLD}${msg}${RESET}`);
}
function ok(msg: string) { log(`  ${GREEN}✓${RESET} ${msg}`); }
function info(msg: string) { log(`  ${BLUE}→${RESET} ${msg}`); }
function warn(msg: string) { log(`  ${YELLOW}!${RESET} ${msg}`); }

async function prompt(question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` ${DIM}(${defaultVal})${RESET}` : "";
  process.stdout.write(`  ${CYAN}?${RESET} ${question}${suffix}: `);
  for await (const line of console) {
    const val = line.trim() || defaultVal || "";
    return val;
  }
  return defaultVal || "";
}

async function main() {
  log(`\n${BOLD}${CYAN}google-workspace-mcp${RESET} ${DIM}setup wizard${RESET}\n`);
  log(`${DIM}Calendar · Gmail · Drive — one MCP tool, optimized for LLMs${RESET}`);

  const totalSteps = 4;

  // Step 1: Check prerequisites
  step(1, totalSteps, "Google Cloud credentials");

  let clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"] || "";
  let clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"] || "";

  if (clientId && clientSecret) {
    ok(`Client ID found: ${clientId.slice(0, 20)}...`);
  } else {
    log("");
    info("You need OAuth credentials from Google Cloud Console:");
    log(`  ${DIM}1. Go to ${RESET}https://console.cloud.google.com/apis/credentials`);
    log(`  ${DIM}2. Create OAuth client ID → Desktop Application${RESET}`);
    log(`  ${DIM}3. Enable Calendar, Gmail, and Drive APIs${RESET}`);
    log(`  ${DIM}4. Copy the Client ID and Secret below${RESET}`);
    log("");

    clientId = await prompt("Client ID");
    if (!clientId) { log(`\n${RED}Client ID is required.${RESET}`); process.exit(1); }
    clientSecret = await prompt("Client Secret");
    if (!clientSecret) { log(`\n${RED}Client Secret is required.${RESET}`); process.exit(1); }
    ok("Credentials saved");
  }

  // Step 2: Default email
  step(2, totalSteps, "Default Google account");

  let defaultEmail = process.env["GOOGLE_DEFAULT_EMAIL"] || "";
  if (!defaultEmail) {
    defaultEmail = await prompt("Your Google email (e.g. you@gmail.com)");
    if (!defaultEmail) { log(`\n${RED}Email is required.${RESET}`); process.exit(1); }
  }
  ok(`Default account: ${defaultEmail}`);

  // Step 3: Generate MCP config
  step(3, totalSteps, "MCP configuration");

  const projectDir = process.cwd();
  const entryPoint = join(projectDir, "src", "index.ts");

  const mcpConfig = {
    command: "bun",
    args: ["run", entryPoint],
    env: {
      GOOGLE_OAUTH_CLIENT_ID: clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: clientSecret,
      GOOGLE_DEFAULT_EMAIL: defaultEmail,
    },
  };

  const globalMcpPath = join(homedir(), ".mcp.json");
  let existingConfig: any = {};

  if (existsSync(globalMcpPath)) {
    try {
      existingConfig = JSON.parse(readFileSync(globalMcpPath, "utf-8"));
    } catch { /* start fresh */ }
  }

  if (!existingConfig.mcpServers) existingConfig.mcpServers = {};

  const alreadyExists = !!existingConfig.mcpServers["google"];
  existingConfig.mcpServers["google"] = mcpConfig;

  // Show the config
  log("");
  info("Adding to ~/.mcp.json:");
  log(`${DIM}${JSON.stringify({ google: mcpConfig }, null, 2).split("\n").map(l => "    " + l).join("\n")}${RESET}`);
  log("");

  if (alreadyExists) {
    warn("Replacing existing 'google' server config");
  }

  const confirm = await prompt("Write config to ~/.mcp.json?", "yes");
  if (confirm.toLowerCase().startsWith("n")) {
    info("Skipped. You can add the config manually.");
  } else {
    writeFileSync(globalMcpPath, JSON.stringify(existingConfig, null, 2) + "\n");
    ok("Config written to ~/.mcp.json");
  }

  // Step 4: First auth
  step(4, totalSteps, "Authentication");

  info(`Opening browser to authorize ${defaultEmail}...`);
  info("Complete the OAuth flow in your browser.");
  log("");

  process.env["GOOGLE_OAUTH_CLIENT_ID"] = clientId;
  process.env["GOOGLE_OAUTH_CLIENT_SECRET"] = clientSecret;
  process.env["GOOGLE_DEFAULT_EMAIL"] = defaultEmail;

  try {
    const { executeCommand } = await import("./commands.ts");
    const result = await executeCommand("cal");
    log("");
    ok("Authentication successful! Here are your upcoming events:");
    log("");
    log(result);
  } catch (err: any) {
    if (err.constructor?.name === "AuthRequiredError") {
      log("");
      info("Browser opened for authorization.");
      info("After authorizing, restart your MCP client (e.g. Claude Code).");
    } else {
      warn(`Auth test failed: ${err.message}`);
      info("You can authenticate later when you first use the tool.");
    }
  }

  // Done
  log(`\n${GREEN}${BOLD}Setup complete!${RESET}\n`);
  log(`${DIM}Next steps:${RESET}`);
  log(`  1. Restart your MCP client (Claude Code, etc.)`);
  log(`  2. Try: ${CYAN}google cal${RESET}`);
  log(`  3. Add more accounts: ${CYAN}google cal --as other@email.com${RESET}`);
  log("");
}

main().catch(err => {
  console.error(`${RED}Setup failed:${RESET} ${err.message}`);
  process.exit(1);
});
