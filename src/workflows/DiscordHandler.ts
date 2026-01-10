import { Logger, LogLevel, SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits, Partials } from 'discord.js';
import { Context, Data, Effect, Layer, Runtime } from 'effect';

import { EnvTag } from '../core/schemas';

export class DiscordError extends Data.TaggedError('DiscordError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface DiscordHandler {
  readonly client: SapphireClient;
  readonly login: () => Effect.Effect<void, DiscordError>;
  readonly isMaintenance: boolean;
  readonly clearLoginTimeout: () => void;
}

export const DiscordHandlerTag = Context.GenericTag<DiscordHandler>('@workflow/DiscordHandler');

const createDiscordClient = Effect.gen(function* () {
  const env = yield* EnvTag;
  const runtime = yield* Effect.runtime();

  const client = new SapphireClient({
    typing: true,
    shards: 'auto',
    disableMentionPrefix: true,
    caseInsensitiveCommands: true,
    caseInsensitivePrefixes: true,
    loadDefaultErrorListeners: true,
    loadMessageCommandListeners: true,
    logger: new Logger(LogLevel.Debug),
    partials: [...Object.values(Partials)] as Partials[],
    intents: [...Object.values(GatewayIntentBits)] as GatewayIntentBits[],
  });

  client.logger.trace = (...v) => Runtime.runSync(runtime)(Effect.logTrace(...v));
  client.logger.debug = (...v) => Runtime.runSync(runtime)(Effect.logDebug(...v));
  client.logger.info = (...v) => Runtime.runSync(runtime)(Effect.logInfo(...v));
  client.logger.warn = (...v) => Runtime.runSync(runtime)(Effect.logWarning(...v));
  client.logger.error = (...v) => Runtime.runSync(runtime)(Effect.logError(...v));
  client.logger.fatal = (...v) => Runtime.runSync(runtime)(Effect.logFatal(...v));

  // Set a timeout for the initial login attempt to prevent hanging.
  let loginTimeout: NodeJS.Timeout | undefined = setTimeout(() => {
    Runtime.runSync(runtime)(Effect.logInfo('YoruClient login timeout.'));
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

export const DiscordHandlerLayer = Layer.scoped(
  DiscordHandlerTag,
  Effect.acquireRelease(createDiscordClient, ({ client }) =>
    Effect.sync(() => {
      client.destroy();
    }),
  ),
);
