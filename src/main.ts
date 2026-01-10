import 'dotenv/config';

import { Effect, Layer, Logger } from 'effect';

import { ConfigStoreLayer, EnvLayer, SessionStoreLayer } from './core/schemas';
import { ClashLayer, ClashTag } from './services/ClashService';
import { createConfig as dbConfig, SqliteLayer } from './services/database';
import { HttpLayer } from './services/HttpService';
import { createLogger, LoggerLayer } from './services/LoggerService';
import { cycleMidnightRestart, cycleWithRestart, runForkWithCleanUp } from './services/RuntimeService';
import { CommandHandlerLayer } from './workflows/CommandHandler';
import { DiscordHandlerLayer, DiscordHandlerTag } from './workflows/DiscordHandler';
import { EventHandlerLayer } from './workflows/EventHandler';

const program = Effect.gen(function* () {
  const discord = yield* DiscordHandlerTag;

  yield* ClashTag;
  yield* discord.login();
  yield* cycleMidnightRestart;
});
const logger = createLogger({ exception: false, rejection: false });

const InfraLayer = Layer.mergeAll(EnvLayer, HttpLayer, ConfigStoreLayer, SessionStoreLayer, SqliteLayer(dbConfig()));

const ServicesLayer = Layer.mergeAll(ClashLayer, DiscordHandlerLayer, CommandHandlerLayer);

const MainLayer = ServicesLayer.pipe(Layer.provide(InfraLayer), Layer.merge(InfraLayer));

const AppLayer = EventHandlerLayer.pipe(Layer.provide(MainLayer), Layer.merge(MainLayer));

const runnable = program.pipe(Effect.provide(AppLayer), Effect.provide(LoggerLayer(Logger.defaultLogger, logger)));

runForkWithCleanUp(cycleWithRestart(runnable.pipe(Effect.scoped)));
