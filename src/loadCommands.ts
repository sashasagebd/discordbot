import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';
import type { Command } from './types.js';

const commandsDir = fileURLToPath(new URL('./commands/', import.meta.url));

// Imports every file in src/commands/ and its subfolders (or dist/commands/ after a build).
// Each file must `export default` an object matching the Command interface.
export async function loadCommands(): Promise<Collection<string, Command>> {
  const commands = new Collection<string, Command>();
  const files = (await readdir(commandsDir, { recursive: true })).filter(
    (file) => /\.(ts|js)$/.test(file) && !file.endsWith('.d.ts'),
  );

  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
    const command: Command | undefined = mod.default;
    if (!command?.data || typeof command.execute !== 'function') {
      console.warn(`Skipping ${file}: default export is missing "data" or "execute".`);
      continue;
    }
    if (commands.has(command.data.name)) {
      throw new Error(`Duplicate command name "${command.data.name}" in ${file}`);
    }
    commands.set(command.data.name, command);
  }

  return commands;
}
