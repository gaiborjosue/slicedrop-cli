import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CONFIG_DIR, CONFIG_PATH } from "./constants.js";

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeJson(CONFIG_PATH, config);
}

export async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function configPropertyFor(key) {
  return {
    "dropbox-app-key": "dropboxAppKey",
    "dropbox-root-folder": "dropboxRootFolder",
  }[key];
}

export function maskSecret(value) {
  if (value.length <= 8) {
    return "********";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
