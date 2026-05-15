import { authDropbox } from "../providers/dropbox.js";

export async function handleAuth(args) {
  const [provider, ...rest] = args;
  if (provider === "dropbox") {
    await authDropbox(rest);
    return;
  }

  throw new Error("Usage: slicedrop auth dropbox [--app-key <key>]");
}
