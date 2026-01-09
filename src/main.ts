import 'dotenv/config';

import { Effect, Layer, Logger } from 'effect';

import { ClashClientTag, ClashServiceLayer } from './services/ClashService';
import { ConfigStoreLayer, SessionStoreLayer } from './services/ConfigService';
import { config as dbConfig, SqliteLayer } from './services/database';
import { HttpService } from './services/HttpService';
import { createLogger, LoggerService } from './services/LoggerService';
import { cycleMidnightRestart, cycleWithRestart, runForkWithCleanUp } from './services/RuntimeService';
import { CommandServiceLayer } from './workflows/CommandService';
import { DiscordClientTag, DiscordServiceLayer } from './workflows/DiscordService';
import { EventHandlerLayer } from './workflows/EventHandler';

const main = () => {
  const program = Effect.gen(function* () {
    const discord = yield* DiscordClientTag;

    yield* ClashClientTag;
    yield* discord.login();
    yield* cycleMidnightRestart;
  });

  const logger = createLogger({ exception: false, rejection: false });

  const MainLayer = Layer.mergeAll(ConfigStoreLayer, SessionStoreLayer, HttpService, SqliteLayer(dbConfig())).pipe(
    Layer.provideMerge(ClashServiceLayer),
    Layer.provideMerge(DiscordServiceLayer),
    Layer.provideMerge(CommandServiceLayer),
    Layer.provideMerge(EventHandlerLayer),
  );

  const runnable = program.pipe(Effect.provide(MainLayer), Effect.provide(LoggerService(Logger.defaultLogger, logger)));

  runForkWithCleanUp(cycleWithRestart(runnable));
};

main();
