import 'dotenv/config';

import { Effect, Layer, Logger } from 'effect';

import { ConfigStoreLayer, EnvLayer, SessionStoreLayer } from './core/schemas';
import { ClashLayer, ClashTag } from './services/ClashService';
import { createConfig as dbConfig, SqliteLayer } from './services/database';
import { HttpLayer } from './services/HttpService';
import { createLogger, LoggerLayer } from './services/LoggerService';
import { cycleMidnightRestart, cycleWithRestart, runForkWithCleanUp } from './services/RuntimeService';
import { CommandHandlerLayer } from './workflows/CommandHandler';
import { DiscordClientTag, DiscordHandlerLayer } from './workflows/DiscordHandler';
import { EventHandlerLayer } from './workflows/EventHandler';

const program = Effect.gen(function* () {
  const discord = yield* DiscordClientTag;

  yield* ClashTag;
  yield* discord.login();
  yield* cycleMidnightRestart;
});

const InfraLayer = Layer.mergeAll(EnvLayer, ConfigStoreLayer, SessionStoreLayer, HttpLayer, SqliteLayer(dbConfig()));

const AppLayer = InfraLayer.pipe(
  Layer.provideMerge(ClashLayer),
  Layer.provideMerge(EventHandlerLayer),
  Layer.provideMerge(CommandHandlerLayer),
  Layer.provideMerge(DiscordHandlerLayer),
);

const logger = createLogger({ exception: false, rejection: false });

const runnable = program.pipe(Effect.provide(AppLayer), Effect.provide(LoggerLayer(Logger.defaultLogger, logger)));

runForkWithCleanUp(cycleWithRestart(runnable));
