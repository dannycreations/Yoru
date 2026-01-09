import { isErrorLike } from '@vegapunk/utilities/result';
import { HTTPError } from 'clashofclans.js';
import { Context, Effect, Layer } from 'effect';

import { ConfigStore } from '../core/schemas';
import { ClashApiError, ClashService } from '../services/ClashService';
import { SqliteDatabase } from '../services/database';
import { checkCommand } from './commands/CheckCommand';
import { linkCommand } from './commands/LinkCommand';
import { pingCommand } from './commands/PingCommand';

import type { Message } from 'discord.js';
import type { DiscordHandler } from './DiscordHandler';

/**
 * Defines the structure for command context, providing access to the message and its arguments.
 */
export interface CommandContext {
  message: Message<true>;
  args: string[];
}

/**
 * Represents the command handling service.
 */
export interface CommandHandler {
  readonly handleCommand: (message: Message<true>) => Effect.Effect<void, never, SqliteDatabase | DiscordHandler | ConfigStore | ClashService>;
}

/**
 * Context tag for the CommandHandler.
 */
export const CommandHandlerTag = Context.GenericTag<CommandHandler>('@workflows/CommandHandler');

/**
 * Implementation of the CommandHandler.
 * Orchestrates command parsing and dispatching to specific command handlers.
 */
export const CommandHandler = Effect.gen(function* () {
  const configStore = yield* ConfigStore;

  // Mapping of command names and aliases to their respective handler functions.
  const commandMap: Record<
    string,
    (message: Message<true>, args: string[]) => Effect.Effect<void, unknown, SqliteDatabase | DiscordHandler | ConfigStore | ClashService>
  > = {
    ping: (message) => pingCommand(message),
    p: (message) => pingCommand(message),
    check: (message, args) => checkCommand(message, args),
    c: (message, args) => checkCommand(message, args),
    link: (message, args) => linkCommand(message, args),
    l: (message, args) => linkCommand(message, args),
  };

  /**
   * Main entry point for processing incoming messages as potential commands.
   */
  const handleCommand = (message: Message<true>) =>
    Effect.gen(function* () {
      const config = yield* configStore.get;
      const prefix = config.prefix;

      // Ensure the message starts with the configured prefix.
      if (!message.content.startsWith(prefix)) return;

      // Parse the message into command name and arguments.
      const parts = message.content.slice(prefix.length).trim().split(/\s+/);
      const commandName = parts.shift()?.toLowerCase();
      const args = parts;

      // Check if the command exists in our map.
      if (!commandName || !commandMap[commandName]) return;

      // Execute the command and handle any errors.
      yield* commandMap[commandName](message, args).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            let field = `> ${message.content}\nUnhandled Rejection, please contact owner!`;

            const cause = error instanceof ClashApiError ? error.cause : error;

            if (cause instanceof HTTPError) {
              field = `> ${message.content}\n${cause.message}`;
              // Specific handling for common Clash API errors to provide more user-friendly messages.
              if (cause.reason === 'notFound' && cause.path.includes('/players/')) {
                field = `> ${message.content}\nError, Player tag not found!`;
              }
            } else if (error instanceof ClashApiError) {
              field = `> ${message.content}\n${error.message}`;
            } else if (isErrorLike(error) && 'message' in error) {
              field = `> ${message.content}\n${error.message}`;
            } else {
              // Log unexpected errors for debugging while keeping the user informed of a general failure.
              yield* Effect.logError('Unexpected command error', error);
            }
            yield* Effect.tryPromise(() => message.reply(field));
          }),
        ),
        Effect.ignore,
      );
    });

  return {
    handleCommand,
  } as const;
});

/**
 * Layer for providing the CommandHandler implementation.
 */
export const CommandHandlerLayer = Layer.effect(CommandHandlerTag, CommandHandler);
