import { executeCommand } from "./src/commands.ts";

const tests = [
  // Calendar
  { name: "cal (default)", cmd: "cal" },
  { name: "cal tomorrow", cmd: "cal tomorrow" },
  { name: "cal search", cmd: "cal search defense" },
  { name: "cal detail (short ID)", cmd: "cal detail __FIRST_EVENT_ID__", dynamic: true },
  { name: "cal busy tomorrow", cmd: "cal busy tomorrow" },
  { name: "cal calendars", cmd: "cal calendars" },
  // Gmail
  { name: "mail (unread)", cmd: "mail" },
  { name: "mail search", cmd: "mail search from:alice" },
  { name: "mail labels", cmd: "mail labels" },
  // Drive
  { name: "drive ls", cmd: "drive ls" },
  { name: "drive search", cmd: "drive search budget" },
  // Errors
  { name: "unknown command", cmd: "blabla" },
  { name: "missing args: cal detail", cmd: "cal detail" },
  { name: "missing args: mail read", cmd: "mail read" },
  { name: "missing args: drive search", cmd: "drive search" },
  // Aliases
  { name: "alias: agenda", cmd: "agenda" },
  { name: "alias: gmail", cmd: "gmail labels" },
  { name: "alias: fichiers", cmd: "fichiers search test" },
];

let firstEventId = "";
let passed = 0;
let failed = 0;

for (const test of tests) {
  let cmd = test.cmd;
  if (test.dynamic && firstEventId) {
    cmd = cmd.replace("__FIRST_EVENT_ID__", firstEventId);
  } else if (test.dynamic) {
    console.log(`  SKIP  ${test.name} (no event ID yet)`);
    continue;
  }

  try {
    const result = await executeCommand(cmd);
    const preview = result.split("\n").slice(0, 2).join(" | ").slice(0, 80);
    console.log(`  PASS  ${test.name.padEnd(30)} → ${preview}`);
    passed++;

    // Capture first event ID for detail test
    if (test.name === "cal (default)") {
      const match = result.match(/\[([a-z0-9]{6})\]/);
      if (match) firstEventId = match[1]!;
    }
  } catch (err: any) {
    if (err.constructor.name === "AuthRequiredError") {
      console.log(`  AUTH  ${test.name.padEnd(30)} → needs auth (expected for new accounts)`);
      passed++;
    } else {
      console.log(`  FAIL  ${test.name.padEnd(30)} → ${err.message?.slice(0, 60)}`);
      failed++;
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
