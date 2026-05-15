#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import open from "open";
import { lookup as lookupMime } from "mime-types";
import { Files } from "files-sdk";
import { dropbox } from "files-sdk/dropbox";
import { DropboxAuth } from "dropbox";

const DEFAULT_DROPBOX_APP_KEY = "56ojxezej9ocwcw";
const DEFAULT_VIEWER_URL = "https://slicedrop.github.io/reloaded/";
const CONFIG_DIR = path.join(os.homedir(), ".slicedrop");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DROPBOX_TOKEN_PATH = path.join(CONFIG_DIR, "dropbox-token.json");
const DROPBOX_SCOPES = [
  "files.content.write",
  "files.content.read",
  "files.metadata.write",
  "files.metadata.read",
  "sharing.write",
  "sharing.read",
];

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "auth") {
    await handleAuth(args);
    return;
  }

  if (command === "share") {
    await handleShare(args);
    return;
  }

  if (command === "config") {
    await handleConfig(args);
    return;
  }

  if (command === "proxy") {
    await handleProxy(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function handleAuth(args) {
  const [provider, ...rest] = args;
  if (provider === "dropbox") {
    await authDropbox(rest);
    return;
  }

  throw new Error("Usage: slicedrop auth dropbox [--app-key <key>]");
}

async function authDropbox(rest) {
  const options = parseOptions(rest);
  const config = await loadConfig();
  const appKey = options["app-key"] ?? options.appKey ?? config.dropboxAppKey ?? DEFAULT_DROPBOX_APP_KEY;

  const tokens = await runDropboxOAuth(appKey);

  if (!tokens.refresh_token) {
    throw new Error("Dropbox did not return a refresh token. Make sure offline access was requested and try again.");
  }

  config.dropboxAppKey = appKey;
  await saveConfig(config);
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeJson(DROPBOX_TOKEN_PATH, {
    account_id: tokens.account_id,
    createdAt: new Date().toISOString(),
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
    token_type: tokens.token_type,
  });

  console.log("Authorized Dropbox.");
  console.log(`Saved token: ${DROPBOX_TOKEN_PATH}`);
}

async function handleShare(args) {
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

async function shareDropbox({ config, filePath, fileStat, options }) {
  const appKey = options["app-key"] ?? options.appKey ?? config.dropboxAppKey ?? DEFAULT_DROPBOX_APP_KEY;

  const token = await loadDropboxToken();
  const rootFolderPath = options["root-folder"] ?? options["dropbox-root-folder"] ?? config.dropboxRootFolder ?? "";

  if (options.expires) {
    throw new Error("Dropbox public shared links do not support --expires. Omit --expires for Dropbox.");
  }

  const files = new Files({
    adapter: dropbox({
      appKey,
      refreshToken: token.refresh_token,
      rootFolderPath,
      publicByDefault: true,
    }),
  });

  console.error(`Computing SHA-256 for ${path.basename(filePath)}...`);
  const key = await makeContentAddressedKey(filePath);
  const contentType = contentTypeFor(filePath);
  console.error(`Using Dropbox${rootFolderPath ? ` folder: ${rootFolderPath}` : ""}`);

  let remoteFileUrl;
  try {
    if (await storedFileExists(files, key)) {
      console.error("Already uploaded, reusing existing Dropbox file.");
    } else {
      console.error(`Uploading ${path.basename(filePath)} (${formatBytes(fileStat.size)})...`);
      await files.upload(key, Readable.toWeb(createReadStream(filePath)), {
        contentType,
      });
    }
    remoteFileUrl = dropboxDirectDownloadUrl(await files.url(key));
  } catch (error) {
    if (!String(error.message).includes("shared_link_already_exists")) {
      throw error;
    }
    remoteFileUrl = await existingDropboxSharedLink(files.raw, dropboxPathForKey(rootFolderPath, key));
  }

  const fileUrl = options.proxy ? buildProxyUrl(options.proxy, remoteFileUrl) : remoteFileUrl;
  const viewerUrl = buildViewerUrl(options.viewer ?? DEFAULT_VIEWER_URL, fileUrl, path.basename(filePath));
  console.log(viewerUrl);
}

async function handleConfig(args) {
  const [action, key, value] = args;

  if (!action || action === "-h" || action === "--help") {
    printConfigHelp();
    return;
  }

  const configKey = configPropertyFor(key);
  if (!configKey) {
    throw new Error("Supported config keys: dropbox-app-key, dropbox-root-folder");
  }

  const config = await loadConfig();

  if (action === "set") {
    if (!value) {
      throw new Error(`Usage: slicedrop config set ${key} <value>`);
    }
    config[configKey] = value;
    await saveConfig(config);
    console.log(`Saved ${key} to ${CONFIG_PATH}`);
    return;
  }

  if (action === "get") {
    if (!config[configKey]) {
      console.log(`${key} is not set.`);
      return;
    }
    console.log(configKey === "dropboxAppKey" ? maskSecret(config[configKey]) : config[configKey]);
    return;
  }

  if (action === "unset") {
    delete config[configKey];
    await saveConfig(config);
    console.log(`Removed ${key} from local config.`);
    return;
  }

  throw new Error(`Unknown config action: ${action}`);
}

async function handleProxy(args) {
  const options = parseOptions(args);
  const port = Number(options.port ?? 8787);
  const host = options.host ?? "127.0.0.1";

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("--port must be a valid TCP port.");
  }

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
    const target = requestUrl.searchParams.get("url");

    if (!target) {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("SliceDrop CLI proxy. Use /?url=<encoded-url>.");
      return;
    }

    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {
        "Access-Control-Allow-Origin": "*",
        Allow: "GET, HEAD, OPTIONS",
      });
      response.end();
      return;
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(target);
    } catch {
      response.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Invalid target URL.");
      return;
    }

    if (parsedTarget.protocol !== "https:") {
      response.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Only https targets are allowed.");
      return;
    }

    try {
      const headers = {};
      for (const name of ["accept", "range", "if-none-match", "if-modified-since"]) {
        const value = request.headers[name];
        if (value) {
          headers[name] = Array.isArray(value) ? value.join(", ") : value;
        }
      }

      const upstream = await fetch(parsedTarget, {
        headers,
        method: request.method,
        redirect: "follow",
      });

      const responseHeaders = corsProxyHeaders(upstream.headers);
      response.writeHead(upstream.status, upstream.statusText, responseHeaders);

      if (request.method === "HEAD" || !upstream.body) {
        response.end();
        return;
      }

      Readable.fromWeb(upstream.body).pipe(response);
    } catch (error) {
      response.writeHead(502, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(`Proxy error: ${error.message}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  console.log(`SliceDrop CLI proxy listening at http://${host}:${port}/`);
  console.log("Press Ctrl+C to stop it.");
}

function parseOptions(args, positionals = []) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const name = rawName.trim();
    const value = inlineValue ?? args[index + 1];

    if (!name) {
      throw new Error(`Invalid option: ${arg}`);
    }

    if (inlineValue === undefined) {
      if (value === undefined || value.startsWith("--")) {
        options[name] = true;
        continue;
      }
      index += 1;
    }

    options[name] = value;
  }

  return options;
}

async function loadDropboxToken() {
  let raw;
  try {
    raw = await readFile(DROPBOX_TOKEN_PATH, "utf8");
  } catch {
    throw new Error("Dropbox is not authorized yet. Run: slicedrop auth dropbox");
  }

  const token = JSON.parse(raw);
  if (!token.refresh_token) {
    throw new Error("Stored Dropbox token is missing refresh_token. Run: slicedrop auth dropbox");
  }
  return token;
}

async function loadConfig() {
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

async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeJson(CONFIG_PATH, config);
}

async function runDropboxOAuth(appKey) {
  const redirect = new URL("http://localhost/");
  const auth = new DropboxAuth({ clientId: appKey });
  const state = randomBytes(16).toString("hex");

  return await new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      try {
        const callback = new URL(request.url ?? "/", `http://localhost:${server.address().port}`);
        if (callback.pathname !== redirect.pathname) {
          response.writeHead(404);
          response.end("Not found.");
          return;
        }

        if (callback.searchParams.get("state") !== state) {
          response.writeHead(400);
          response.end("Invalid OAuth state.");
          reject(new Error("Invalid OAuth state."));
          return;
        }

        const error = callback.searchParams.get("error");
        if (error) {
          response.writeHead(400);
          response.end("Authorization rejected.");
          reject(new Error(error));
          return;
        }

        const code = callback.searchParams.get("code");
        if (!code) {
          response.writeHead(400);
          response.end("No authorization code provided.");
          reject(new Error("No authorization code provided."));
          return;
        }

        const result = await auth.getAccessTokenFromCode(redirect.toString(), code);
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<h1>SliceDrop CLI is authorized for Dropbox.</h1><p>You can close this tab.</p>");
        resolve(result.result);
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address();
        redirect.port = String(address.port);
        const authorizeUrl = await auth.getAuthenticationUrl(
          redirect.toString(),
          state,
          "code",
          "offline",
          DROPBOX_SCOPES,
          "none",
          true
        );

        console.log("Opening your browser for Dropbox authorization...");
        console.log(authorizeUrl);
        await open(authorizeUrl, { wait: false });
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
}

async function makeContentAddressedKey(filePath) {
  const hash = await sha256File(filePath);
  return `shares/sha256-${hash}${storageExtension(filePath)}`;
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function storedFileExists(files, key) {
  try {
    await files.head(key);
    return true;
  } catch (error) {
    const message = String(error?.message ?? "").toLowerCase();
    if (error?.code === "NotFound" || message.includes("not_found") || message.includes("not found")) {
      return false;
    }
    throw error;
  }
}

function storageExtension(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.endsWith(".nii.gz")) {
    return ".nii.gz";
  }
  if (name.endsWith(".tar.gz")) {
    return ".tar.gz";
  }
  const ext = path.extname(name);
  return ext || ".bin";
}

async function existingDropboxSharedLink(client, dropboxPath) {
  const response = await client.sharingListSharedLinks({
    direct_only: true,
    path: dropboxPath,
  });
  const link = response.result.links?.[0]?.url;
  if (!link) {
    throw new Error("Dropbox says a shared link already exists, but no existing link was returned.");
  }
  return dropboxDirectDownloadUrl(link);
}

function dropboxPathForKey(rootFolderPath, key) {
  const cleanRoot = trimSlashes(rootFolderPath);
  const cleanKey = trimSlashes(key);
  const parts = [cleanRoot, cleanKey].filter(Boolean);
  return `/${parts.join("/")}`;
}

function dropboxDirectDownloadUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname === "www.dropbox.com" || parsed.hostname === "dropbox.com") {
    parsed.hostname = "dl.dropboxusercontent.com";
  }
  parsed.searchParams.delete("dl");
  parsed.searchParams.set("dl", "1");
  return parsed.toString();
}

function trimSlashes(value) {
  return String(value ?? "").replace(/^\/+|\/+$/g, "");
}

function contentTypeFor(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".nii") || lower.endsWith(".nii.gz") || lower.endsWith(".nvd")) {
    return "application/octet-stream";
  }
  return lookupMime(filePath) || "application/octet-stream";
}

function buildViewerUrl(viewerBase, fileUrl, fileName) {
  const viewer = new URL(viewerBase);
  viewer.searchParams.set("url", fileUrl);
  viewer.searchParams.set("name", fileName);
  return viewer.toString();
}

function buildProxyUrl(proxyBase, targetUrl) {
  const proxy = new URL(proxyBase);
  proxy.searchParams.set("url", targetUrl);
  return proxy.toString();
}

function writeCorsPreflight(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept, If-None-Match, If-Modified-Since",
    "Access-Control-Max-Age": "86400",
  });
  response.end();
}

function corsProxyHeaders(upstreamHeaders) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept, If-None-Match, If-Modified-Since",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified",
  };

  for (const name of [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ]) {
    const value = upstreamHeaders.get(name);
    if (value) {
      headers[name] = value;
    }
  }

  return headers;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units.shift();
  while (value >= 1024 && units.length > 0) {
    value /= 1024;
    unit = units.shift();
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function printHelp() {
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

function printConfigHelp() {
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

function configPropertyFor(key) {
  return {
    "dropbox-app-key": "dropboxAppKey",
    "dropbox-root-folder": "dropboxRootFolder",
  }[key];
}

function maskSecret(value) {
  if (value.length <= 8) {
    return "********";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
