import { executeCommand } from "./src/commands.ts";

const cmd = process.argv.slice(2).join(" ") || "help";
try {
  const result = await executeCommand(cmd);
  console.log(result);
} catch (err: any) {
  console.error("Error:", err.message);
}
