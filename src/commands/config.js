import { CONFIG_PATH } from "../constants.js";
import { configPropertyFor, loadConfig, maskSecret, saveConfig } from "../config.js";
import { printConfigHelp } from "../help.js";

export async function handleConfig(args) {
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
