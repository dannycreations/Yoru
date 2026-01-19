import 'dotenv/config';

import { Effect, Layer, Logger } from 'effect';

import { ConfigStoreLayer, ConfigStoreTag, EnvLayer, EnvTag, SessionStoreLayer } from './core/schemas';
import { AccountDatabaseLayer, UserDatabaseLayer } from './database';
import { ClashClientLayer, ClashClientTag, ClashConfigTag } from './services/ClashService';
import { SqliteClientLayer } from './structures/database';
import { HttpClientLayer } from './structures/HttpClient';
import { LoggerClientLayer, makeLoggerClient } from './structures/LoggerClient';
import { cycleMidnightRestart, runMain } from './structures/RuntimeClient';
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
  yield* cycleMidnightRestart;
});

const logger = makeLoggerClient({ exception: false, rejection: false });

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
        const { sqliteConfig } = yield* Effect.promise(() => import('./database/index.js'));
        const config = yield* sqliteConfig;
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
  Layer.provideMerge(
    Layer.effect(
      ClashConfigTag,
      Effect.gen(function* () {
        const env = yield* EnvTag;
        return {
          email: env.CLASH_EMAIL,
          password: env.CLASH_PASSWORD,
        };
      }),
    ),
  ),
);

runMain(program.pipe(Effect.provide(MainLayer)), {
  runtimeBaseLayer: BaseLayer,
});
