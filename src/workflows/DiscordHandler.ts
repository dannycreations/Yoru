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

  // The Sapphire client's internal logger bridges to the Effect runtime's logger to centralize logs and adhere to project-wide logging configurations.
  const bridgeLogger =
    (effect: (...args: unknown[]) => Effect.Effect<void>) =>
    (...args: unknown[]) =>
      Runtime.runSync(runtime)(effect(...args));

  client.logger.trace = bridgeLogger(Effect.logTrace);
  client.logger.debug = bridgeLogger(Effect.logDebug);
  client.logger.info = bridgeLogger(Effect.logInfo);
  client.logger.warn = bridgeLogger(Effect.logWarning);
  client.logger.error = bridgeLogger(Effect.logError);
  client.logger.fatal = bridgeLogger(Effect.logFatal);

  // A timeout mechanism for the initial connection prevents the process from hanging indefinitely if the Discord gateway is unresponsive.
  let loginTimeout: NodeJS.Timeout | undefined = setTimeout(() => {
    Runtime.runSync(runtime)(Effect.logWarning('Discord client login timed out after 60 seconds.'));
    client.destroy();
  }, 60_000).unref();

  const clearLoginTimeout = () => {
    if (loginTimeout) {
      clearTimeout(loginTimeout);
      loginTimeout = undefined;
    }
  };

  // The login timeout clears automatically once the client is ready to ensure the watchdog does not trigger after a successful connection.
  client.once('ready', () => clearLoginTimeout());

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
