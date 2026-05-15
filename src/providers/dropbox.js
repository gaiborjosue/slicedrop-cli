import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import open from "open";
import { Files } from "files-sdk";
import { dropbox } from "files-sdk/dropbox";
import { DropboxAuth } from "dropbox";
import {
  CONFIG_DIR,
  DEFAULT_DROPBOX_APP_KEY,
  DEFAULT_VIEWER_URL,
  DROPBOX_SCOPES,
  DROPBOX_TOKEN_PATH,
} from "../constants.js";
import { loadConfig, saveConfig, writeJson } from "../config.js";
import { contentTypeFor, formatBytes, makeContentAddressedKey } from "../file-utils.js";
import { parseOptions } from "../options.js";
import { buildProxyUrl, buildViewerUrl } from "../urls.js";

export async function authDropbox(args) {
  const options = parseOptions(args);
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

export async function shareDropbox({ config, filePath, fileStat, options }) {
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
