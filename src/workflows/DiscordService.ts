import { SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits, Partials } from 'discord.js';
import { Context, Data, Effect, Layer } from 'effect';

import { ConfigStore, EnvTag } from '../core/schemas';

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

const createDiscordService = Effect.gen(function* () {
  const configStore = yield* ConfigStore;
  const config = yield* configStore.get;
  const env = yield* EnvTag;

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
      try: () => client.login(env.DISCORD_TOKEN),
      catch: (error) => new DiscordError({ message: 'Failed to login to Discord', cause: error }),
    }).pipe(Effect.asVoid);

  const isMaintenance = false;

  return {
    client,
    login,
    isMaintenance,
    clearLoginTimeout,
  } as const;
});

export const DiscordServiceLayer = Layer.scoped(
  DiscordClientTag,
  Effect.acquireRelease(createDiscordService, ({ client }) =>
    Effect.sync(() => {
      client.destroy();
    }),
  ),
);
