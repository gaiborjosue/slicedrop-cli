export function parseOptions(args, positionals = []) {
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
