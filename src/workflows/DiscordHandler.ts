import { Logger, LogLevel, SapphireClient } from '@sapphire/framework';
import { chalk } from '@vegapunk/utilities';
import { GatewayIntentBits, Partials } from 'discord.js';
import { Context, Data, Effect, Layer } from 'effect';

import { EnvTag } from '../core/schemas.js';
import { makeRuntimeBridge } from '../structures/RuntimeClient.js';

export class DiscordError extends Data.TaggedError('DiscordError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface DiscordHandler {
  readonly client: SapphireClient;
  readonly login: () => Effect.Effect<void, DiscordError>;
}

export class DiscordHandlerTag extends Context.Tag('@workflows/DiscordHandler')<DiscordHandlerTag, DiscordHandler>() {}

const makeDiscordClient = Effect.gen(function* () {
  const env = yield* EnvTag;
  const bridge = yield* makeRuntimeBridge;

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

  const bridgeLogger =
    (effect: (...args: unknown[]) => Effect.Effect<void>) =>
    (...args: unknown[]) =>
      bridge.runSync(effect(...args));

  client.logger.trace = bridgeLogger(Effect.logTrace);
  client.logger.debug = bridgeLogger(Effect.logDebug);
  client.logger.info = bridgeLogger(Effect.logInfo);
  client.logger.warn = bridgeLogger(Effect.logWarning);
  client.logger.error = bridgeLogger(Effect.logError);
  client.logger.fatal = bridgeLogger(Effect.logFatal);

  const login = (): Effect.Effect<void, DiscordError> =>
    Effect.tryPromise({
      try: () => client.login(env.DISCORD_TOKEN),
      catch: (cause) => new DiscordError({ message: 'Failed to login to Discord', cause }),
    }).pipe(
      Effect.timeoutFail({
        duration: '60 seconds',
        onTimeout: () => new DiscordError({ message: 'Discord login timed out' }),
      }),
      Effect.tapErrorCause((cause) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(chalk`{yellow Discord client login failed or timed out...}`, cause);
          yield* Effect.promise(() => client.destroy());
        }),
      ),
    );

  return {
    client,
    login,
  } as const;
});

export const DiscordHandlerLayer = Layer.scoped(
  DiscordHandlerTag,
  Effect.acquireRelease(makeDiscordClient, ({ client }) => Effect.promise(() => client.destroy())),
);
