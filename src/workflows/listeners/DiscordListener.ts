import { Events } from '@sapphire/framework';
import { ActivityType } from 'discord.js';
import { Effect } from 'effect';

import { ConfigStoreTag } from '../../core/schemas';
import { CommandHandlerTag } from '../CommandHandler';
import { DiscordHandlerTag } from '../DiscordHandler';

import type { SapphireClient } from '@sapphire/framework';
import type { Message } from 'discord.js';

export const createDiscordListener = (
  register: (client: SapphireClient, event: string, handler: (...args: any[]) => Effect.Effect<void, unknown, any>, once?: boolean) => void,
) =>
  Effect.gen(function* () {
    const discordHandler = yield* DiscordHandlerTag;
    const configStore = yield* ConfigStoreTag;
    const commandService = yield* CommandHandlerTag;

    const setPresence = (client: SapphireClient<true>) =>
      Effect.sync(() =>
        client.user.setPresence({
          status: 'idle',
          activities: [{ name: 'Clash of Clans', type: ActivityType.Playing }],
        }),
      );

    const onReady = (client: SapphireClient<true>): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        yield* Effect.sleep(1000);
        discordHandler.clearLoginTimeout();

        yield* setPresence(client);

        yield* Effect.logInfo(
          `Bot has started with ${client.users.cache.size} users, ${client.channels.cache.size} channels, and ${client.guilds.cache.size} guilds.`,
        );
      }).pipe(Effect.asVoid);

    const onShardResume = (_: number): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        if (discordHandler.client.user) {
          yield* setPresence(discordHandler.client as SapphireClient<true>);
        }
      });

    const onMessageCreate = (message: Message): Effect.Effect<void, unknown, any> =>
      Effect.gen(function* () {
        if (message.webhookId !== null || message.system || message.author.bot) return;

        const config = yield* configStore.get;
        if (discordHandler.isMaintenance && !config.ownerIds.includes(message.author.id)) {
          yield* Effect.tryPromise(() => message.reply('⚠️ Under Maintenance!')).pipe(Effect.ignore);
          return;
        }

        yield* commandService
          .handleCommand(message as Message<true>)
          .pipe(Effect.catchAllCause((cause) => Effect.logFatal('Unhandled rejection in command handler.', cause)));
      }).pipe(Effect.asVoid);

    register(discordHandler.client, Events.ClientReady, onReady, true);
    register(discordHandler.client, Events.ShardResume, onShardResume);
    register(discordHandler.client, Events.MessageCreate, onMessageCreate);
  });
