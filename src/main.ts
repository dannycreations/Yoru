import 'dotenv/config';

import { Context, Effect, Layer, Logger } from 'effect';

import { ConfigStoreLayer, ConfigStoreTag, EnvLayer, SessionStoreLayer } from './core/schemas';
import { AccountDatabaseLayer, SqliteConfigLayer, SqliteConfigTag, UserDatabaseLayer } from './database';
import { ClashClientLayer, ClashClientTag, ClashConfigLayer } from './services/ClashService';
import { SqliteClientLayer } from './structures/database';
import { HttpClientLayer } from './structures/HttpClient';
import { LoggerClientLayer, makeLoggerClient } from './structures/LoggerClient';
import { cycleUntilMidnight, runMainCycle } from './structures/RuntimeClient';
import { CommandHandlerLayer } from './workflows/CommandHandler';
import { DiscordHandlerLayer, DiscordHandlerTag } from './workflows/DiscordHandler';
import { EventHandlerLayer } from './workflows/EventHandler';
import { MemberHandlerLayer } from './workflows/MemberHandler';

const program = Effect.gen(function* () {
  const clash = yield* ClashClientTag;
  const store = yield* ConfigStoreTag;
  const discord = yield* DiscordHandlerTag;
  const config = yield* store.get;

  if (config.clanTags.length > 0) {
    yield* clash.addClans(config.clanTags);
  }

  yield* discord.login();
  yield* cycleUntilMidnight;
});

const logger = makeLoggerClient();

const BaseLayer = Layer.mergeAll(
  EnvLayer,
  HttpClientLayer,
  ConfigStoreLayer,
  SessionStoreLayer,
  UserDatabaseLayer,
  AccountDatabaseLayer,
  LoggerClientLayer(Logger.defaultLogger, logger),
).pipe(
  Layer.provideMerge(
    Layer.unwrapEffect(
      Effect.gen(function* () {
        const context = yield* Layer.build(SqliteConfigLayer);
        const config = Context.get(context, SqliteConfigTag);
        return SqliteClientLayer(config);
      }),
    ),
  ),
);

const MainLayer = EventHandlerLayer.pipe(
  Layer.provideMerge(DiscordHandlerLayer),
  Layer.provideMerge(CommandHandlerLayer),
  Layer.provideMerge(MemberHandlerLayer),
  Layer.provideMerge(ClashClientLayer),
  Layer.provideMerge(ClashConfigLayer),
);

runMainCycle(program.pipe(Effect.provide(MainLayer), Effect.provide(BaseLayer)));
