import { handleAuth } from "./commands/auth.js";
import { handleConfig } from "./commands/config.js";
import { handleProxy } from "./commands/proxy.js";
import { handleShare } from "./commands/share.js";
import { printHelp } from "./help.js";

export async function main(args) {
  const [command, ...rest] = args;

  if (!command || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "auth") {
    await handleAuth(rest);
    return;
  }

  if (command === "share") {
    await handleShare(rest);
    return;
  }

  if (command === "config") {
    await handleConfig(rest);
    return;
  }

  if (command === "proxy") {
    await handleProxy(rest);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}
