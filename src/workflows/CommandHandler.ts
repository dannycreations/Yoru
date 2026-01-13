import { Context, Effect, Layer } from 'effect';

import { ConfigStoreTag, SessionStoreTag } from '../core/schemas';
import { replyWithError } from '../helpers/error.helper';
import { ClashLayer } from '../services/ClashService';
import { SqliteTag } from '../services/database';
import { checkCommand } from './commands/CheckCommand';
import { linkCommand } from './commands/LinkCommand';
import { pingCommand } from './commands/PingCommand';
import { MemberHandlerTag } from './MemberManager';

import type { Message } from 'discord.js';
import type { DiscordHandler } from './DiscordHandler';

export interface CommandHandler {
  readonly handleCommand: (
    message: Message<true>,
  ) => Effect.Effect<void, never, SqliteTag | DiscordHandler | ConfigStoreTag | SessionStoreTag | ClashLayer | typeof MemberHandlerTag.Service>;
}

export class CommandHandlerTag extends Context.Tag('@workflow/CommandHandlerLayer')<CommandHandlerTag, CommandHandler>() {}

// Centralized command mapping facilitates easy addition of new commands and aliases while maintaining a single point of reference for command execution.
const commandMap: Record<string, (message: Message<true>, args: string[]) => Effect.Effect<void, any, any>> = {
  ping: pingCommand,
  p: pingCommand,
  check: checkCommand,
  c: checkCommand,
  link: linkCommand,
  l: linkCommand,
};

export const CommandHandler = Effect.gen(function* () {
  const configStore = yield* ConfigStoreTag;

  const handleCommand = (message: Message<true>) =>
    Effect.gen(function* () {
      const config = yield* configStore.get;
      const prefix = config.prefix;

      // Messages must start with the configured prefix to be recognized as commands.
      if (!message.content.startsWith(prefix)) return;

      // The message content is parsed into a command name and an array of arguments.
      const parts = message.content.slice(prefix.length).trim().split(/\s+/);
      const commandName = parts.shift()?.toLowerCase();
      const args = parts;

      // Command existence is verified within the mapping before execution.
      const command = commandName ? commandMap[commandName] : undefined;
      if (!command) return;

      // Commands are executed with error handling delegated to a specialized helper to maintain a clean handler loop.
      yield* command(message, args).pipe(
        Effect.catchAll((error) => replyWithError(message, error)),
        Effect.ignore,
      );
    });

  return {
    handleCommand,
  } as const;
});

export const CommandHandlerLayer = Layer.effect(CommandHandlerTag, CommandHandler);
