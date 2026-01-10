import { Context, Effect, Layer } from 'effect';

import { ConfigStoreTag } from '../core/schemas';
import { replyWithError } from '../helpers/error.helper';
import { ClashLayer } from '../services/ClashService';
import { SqliteTag } from '../services/database';
import { checkCommand } from './commands/CheckCommand';
import { linkCommand } from './commands/LinkCommand';
import { pingCommand } from './commands/PingCommand';

import type { Message } from 'discord.js';
import type { DiscordHandler } from './DiscordHandler';

export interface CommandHandler {
  readonly handleCommand: (message: Message<true>) => Effect.Effect<void, never, SqliteTag | DiscordHandler | ConfigStoreTag | ClashLayer>;
}

export const CommandHandlerTag = Context.GenericTag<CommandHandler>('@workflow/CommandHandler');

export const CommandHandler = Effect.gen(function* () {
  const configStore = yield* ConfigStoreTag;

  // Command names and aliases are mapped to their respective handler functions for efficient dispatching.
  const commandMap: Record<
    string,
    (message: Message<true>, args: string[]) => Effect.Effect<void, unknown, SqliteTag | DiscordHandler | ConfigStoreTag | ClashLayer>
  > = {
    ping: (message) => pingCommand(message),
    p: (message) => pingCommand(message),
    check: (message, args) => checkCommand(message, args),
    c: (message, args) => checkCommand(message, args),
    link: (message, args) => linkCommand(message, args),
    l: (message, args) => linkCommand(message, args),
  };

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
      if (commandName === undefined || commandMap[commandName] === undefined) return;

      // Commands are executed with error handling delegated to a specialized helper to maintain a clean handler loop.
      yield* commandMap[commandName](message, args).pipe(
        Effect.catchAll((error) => replyWithError(message, error)),
        Effect.ignore,
      );
    });

  return {
    handleCommand,
  } as const;
});

export const CommandHandlerLayer = Layer.effect(CommandHandlerTag, CommandHandler);
