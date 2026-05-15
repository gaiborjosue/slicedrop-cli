import { CONFIG_PATH, DEFAULT_DROPBOX_APP_KEY, DEFAULT_VIEWER_URL, DROPBOX_TOKEN_PATH } from "./constants.js";

export function printHelp() {
  console.log(`slicedrop-cli

Usage:
  slicedrop auth dropbox [--app-key <key>]
  slicedrop config set dropbox-app-key <key>
  slicedrop config set dropbox-root-folder <path>
  slicedrop config get <key>
  slicedrop config unset <key>
  slicedrop share <file> [--provider dropbox] [--viewer <url>] [--proxy <url>]
  slicedrop proxy [--port 8787]

Defaults:
  Dropbox app key: ${DEFAULT_DROPBOX_APP_KEY}
  Token file:      ${DROPBOX_TOKEN_PATH}
  Viewer:          ${DEFAULT_VIEWER_URL}
`);
}

export function printConfigHelp() {
  console.log(`slicedrop config

Usage:
  slicedrop config set dropbox-app-key <key>
  slicedrop config set dropbox-root-folder <path>
  slicedrop config get <key>
  slicedrop config unset <key>

Config file:
  ${CONFIG_PATH}
`);
}
