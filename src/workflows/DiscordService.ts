import { SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits, Partials } from 'discord.js';
import { Context, Data, Effect, Layer } from 'effect';

import { ConfigStore } from '../services/ConfigService';

export class DiscordError extends Data.TaggedError('DiscordError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface DiscordService {
  readonly client: SapphireClient;
  readonly login: () => Effect.Effect<void, DiscordError>;
  readonly isMaintenance: boolean;
  readonly clearLoginTimeout: () => void;
}

export const DiscordClientTag = Context.GenericTag<DiscordService>('@services/DiscordClient');

const createDiscordService = Effect.gen(function* (_) {
  const configStore = yield* _(ConfigStore);
  const config = yield* _(configStore.get);

  const client = new SapphireClient({
    typing: true,
    shards: 'auto',
    disableMentionPrefix: true,
    caseInsensitiveCommands: true,
    caseInsensitivePrefixes: true,
    loadDefaultErrorListeners: true,
    loadMessageCommandListeners: true,
    defaultPrefix: config.prefix,
    partials: [...Object.values(Partials)] as Partials[],
    intents: [...Object.values(GatewayIntentBits)] as GatewayIntentBits[],
  });

  // Login timeout to prevent hanging on startup
  let loginTimeout: NodeJS.Timeout | undefined = setTimeout(() => {
    Effect.runSync(Effect.logInfo('YoruClient login timeout.'));
    client.destroy();
  }, 60_000).unref();

  const clearLoginTimeout = () => {
    if (loginTimeout) {
      clearTimeout(loginTimeout);
      loginTimeout = undefined;
    }
  };

  const login = () =>
    Effect.tryPromise({
      try: () => client.login(process.env.DISCORD_TOKEN),
      catch: (error) => new DiscordError({ message: 'Failed to login to Discord', cause: error }),
    }).pipe(Effect.asVoid);

  const isMaintenance = false;

  return {
    client,
    login,
    isMaintenance,
    clearLoginTimeout,
  };
});

export const DiscordServiceLayer = Layer.scoped(
  DiscordClientTag,
  Effect.acquireRelease(createDiscordService, ({ client }) =>
    Effect.sync(() => {
      client.destroy();
    }),
  ),
);
