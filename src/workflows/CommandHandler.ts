import { Context, Effect, Layer, Record as ReadonlyRecord } from 'effect';

import { ConfigStoreTag } from '../core/schemas';
import { replyWithError } from '../helpers/ErrorHelper';
import { ClashClientTag } from '../services/ClashService';
import { SqliteClientTag } from '../structures/database';
import { checkCommand } from './commands/CheckCommand';
import { linkCommand } from './commands/LinkCommand';
import { pingCommand } from './commands/PingCommand';
import { MemberHandlerTag } from './MemberHandler';

import type { Message } from 'discord.js';
import type { DiscordHandler } from './DiscordHandler';

export interface CommandHandler {
  readonly handleCommand: (
    message: Message<true>,
  ) => Effect.Effect<void, never, SqliteClientTag | DiscordHandler | ConfigStoreTag | ClashClientTag | MemberHandlerTag>;
}

export class CommandHandlerTag extends Context.Tag('@workflows/CommandHandler')<CommandHandlerTag, CommandHandler>() {}

const commandMap: ReadonlyRecord.ReadonlyRecord<string, (message: Message<true>, args: ReadonlyArray<string>) => Effect.Effect<void, unknown, any>> =
  {
    ping: pingCommand,
    p: pingCommand,
    check: checkCommand,
    c: checkCommand,
    link: linkCommand,
    l: linkCommand,
  } as const;

export const CommandHandler = Effect.gen(function* () {
  const configStore = yield* ConfigStoreTag;

  const handleCommand = (message: Message<true>) =>
    Effect.gen(function* () {
      const config = yield* configStore.get;
      const { prefix } = config;

      if (!message.content.startsWith(prefix)) {
        return;
      }

      const parts = message.content.slice(prefix.length).trim().split(/\s+/);
      const commandName = parts.shift()?.toLowerCase();
      const args = parts as ReadonlyArray<string>;

      const command = commandName ? commandMap[commandName] : undefined;
      if (!command) {
        return;
      }

      yield* command(message, args).pipe(
        Effect.catchAll((error) => replyWithError(message, error)),
        Effect.catchAllCause((cause) => Effect.logError('Command execution failed', cause)),
      );
    });

  return {
    handleCommand,
  } as const;
});

export const CommandHandlerLayer = Layer.effect(CommandHandlerTag, CommandHandler);
