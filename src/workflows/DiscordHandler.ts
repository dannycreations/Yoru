import { Logger, LogLevel, SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits, Partials } from 'discord.js';
import { Context, Data, Effect, Fiber, Layer, Option, Ref } from 'effect';

import { EnvTag } from '../core/schemas';
import { makeBridge } from '../structures/RuntimeClient';

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

export class DiscordHandlerTag extends Context.Tag('@workflows/DiscordHandler')<DiscordHandlerTag, DiscordHandler>() {}

const makeDiscordClient = Effect.gen(function* () {
  const env = yield* EnvTag;
  const bridge = yield* makeBridge;

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
      bridge.sync(effect(...args));

  client.logger.trace = bridgeLogger(Effect.logTrace);
  client.logger.debug = bridgeLogger(Effect.logDebug);
  client.logger.info = bridgeLogger(Effect.logInfo);
  client.logger.warn = bridgeLogger(Effect.logWarning);
  client.logger.error = bridgeLogger(Effect.logError);
  client.logger.fatal = bridgeLogger(Effect.logFatal);

  const loginTimeoutRef = yield* Ref.make(Option.none<Fiber.RuntimeFiber<void, never>>());

  const timeoutFiber = yield* Effect.logWarning('Discord client login timed out...').pipe(
    Effect.zipRight(Effect.sync(() => void client.destroy())),
    Effect.delay('60 seconds'),
    Effect.fork,
  );

  yield* Ref.set(loginTimeoutRef, Option.some(timeoutFiber));

  const clearLoginTimeout = () =>
    bridge.fork(
      Ref.get(loginTimeoutRef).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.zipRight(Ref.set(loginTimeoutRef, Option.none()))),
          }),
        ),
      ),
    );

  client.once('ready', () => clearLoginTimeout());

  const login = (): Effect.Effect<void, DiscordError> =>
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => client.login(env.DISCORD_TOKEN),
        catch: (error) => new DiscordError({ message: 'Failed to login to Discord', cause: error }),
      });
    });

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
  Effect.acquireRelease(makeDiscordClient, ({ client }) =>
    Effect.sync(() => {
      client.destroy();
    }),
  ),
);
