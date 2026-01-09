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

const program = Effect.gen(function* (_) {
  const discord = yield* _(DiscordClientTag);
  yield* _(ClashClientTag);
  yield* _(discord.login());
  yield* _(cycleMidnightRestart);
});

const logger = createLogger({ exception: false, rejection: false });

runForkWithCleanUp(
  cycleWithRestart(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(ConfigStoreLayer, SessionStoreLayer, HttpService, SqliteLayer(dbConfig())).pipe(
          Layer.provideMerge(ClashServiceLayer),
          Layer.provideMerge(DiscordServiceLayer),
          Layer.provideMerge(CommandServiceLayer),
          Layer.provideMerge(EventHandlerLayer),
        ),
      ),
      Effect.provide(LoggerService(Logger.defaultLogger, logger)),
    ),
  ),
);
