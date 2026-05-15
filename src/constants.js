import os from "node:os";
import path from "node:path";

export const DEFAULT_DROPBOX_APP_KEY = "56ojxezej9ocwcw";
export const DEFAULT_VIEWER_URL = "https://gaiborjosue.github.io/slicedrop.github.com/reloaded/";

export const CONFIG_DIR = path.join(os.homedir(), ".slicedrop");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const DROPBOX_TOKEN_PATH = path.join(CONFIG_DIR, "dropbox-token.json");

export const DROPBOX_SCOPES = [
  "files.content.write",
  "files.content.read",
  "files.metadata.write",
  "files.metadata.read",
  "sharing.write",
  "sharing.read",
];
