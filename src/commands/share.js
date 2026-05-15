import { stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import { parseOptions } from "../options.js";
import { shareDropbox } from "../providers/dropbox.js";

export async function handleShare(args) {
  const positionals = [];
  const options = parseOptions(args, positionals);
  const config = await loadConfig();
  const provider = options.provider ?? "dropbox";

  const input = positionals[0];
  if (!input) {
    throw new Error("Usage: slicedrop share <file> [--provider dropbox]");
  }

  const filePath = path.resolve(input);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  if (provider === "dropbox") {
    await shareDropbox({ config, filePath, fileStat, options });
    return;
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
