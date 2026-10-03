import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

export interface Command {
  // Any SlashCommandBuilder variant (with options, subcommands, etc.) satisfies this.
  data: {
    name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  // Only needed if an option uses setAutocomplete(true).
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
  // Handles buttons/menus whose custom ID starts with "<command name>:".
  handleComponent?(interaction: MessageComponentInteraction): Promise<void>;
}
