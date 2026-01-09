import { SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits, Partials } from 'discord.js';
import { Context, Data, Effect, Layer } from 'effect';

import { ConfigStoreTag, EnvTag } from '../core/schemas';

/**
 * Custom error class for Discord-related operations.
 */
export class DiscordError extends Data.TaggedError('DiscordError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Represents the Discord integration service.
 */
export interface DiscordHandler {
  readonly client: SapphireClient;
  readonly login: () => Effect.Effect<void, DiscordError>;
  readonly isMaintenance: boolean;
  readonly clearLoginTimeout: () => void;
}

/**
 * Context tag for the DiscordService.
 */
export const DiscordClientTag = Context.GenericTag<DiscordHandler>('@workflow/DiscordHandler');

/**
 * Implementation of the DiscordService using Sapphire framework.
 */
const createDiscordClient = Effect.gen(function* () {
  const configStore = yield* ConfigStoreTag;
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

  // Set a timeout for the initial login attempt to prevent hanging.
  let loginTimeout: NodeJS.Timeout | undefined = setTimeout(() => {
    Effect.runSync(Effect.logInfo('YoruClient login timeout.'));
    client.destroy();
  }, 60_000).unref();

  /**
   * Clears the login timeout once a successful connection is established.
   */
  const clearLoginTimeout = () => {
    if (loginTimeout) {
      clearTimeout(loginTimeout);
      loginTimeout = undefined;
    }
  };

  /**
   * Logs the client into Discord.
   */
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

/**
 * Layer providing the DiscordService with lifecycle management (acquire/release).
 */
export const DiscordHandlerLayer = Layer.scoped(
  DiscordClientTag,
  Effect.acquireRelease(createDiscordClient, ({ client }) =>
    Effect.sync(() => {
      client.destroy();
    }),
  ),
);
