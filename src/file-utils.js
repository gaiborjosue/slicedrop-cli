import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { lookup as lookupMime } from "mime-types";

export async function makeContentAddressedKey(filePath) {
  const hash = await sha256File(filePath);
  return `shares/sha256-${hash}${storageExtension(filePath)}`;
}

export async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function storageExtension(filePath) {
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

export function contentTypeFor(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".nii") || lower.endsWith(".nii.gz") || lower.endsWith(".nvd")) {
    return "application/octet-stream";
  }
  return lookupMime(filePath) || "application/octet-stream";
}

export function formatBytes(bytes) {
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
