import 'dotenv/config';

import { Effect, Layer, Logger } from 'effect';

import { ConfigStoreLayer, ConfigStoreTag, EnvLayer, EnvTag, SessionStoreLayer } from './core/schemas';
import { AccountDatabaseLayer, sqliteConfig, UserDatabaseLayer } from './database';
import { ClashConfigTag, ClashLayer, ClashTag } from './services/ClashService';
import { SqliteClientLayer } from './structures/database';
import { HttpClientLayer } from './structures/HttpClient';
import { createLogger, LoggerClientLayer } from './structures/LoggerClient';
import { cycleMidnightRestart, cycleWithRestart, runForkWithCleanUp } from './structures/RuntimeClient';
import { CommandHandlerLayer } from './workflows/CommandHandler';
import { DiscordHandlerLayer, DiscordHandlerTag } from './workflows/DiscordHandler';
import { EventHandlerLayer } from './workflows/EventHandler';
import { MemberHandlerLayer } from './workflows/MemberManager';

const program = Effect.gen(function* () {
  const clash = yield* ClashTag;
  const store = yield* ConfigStoreTag;
  const discord = yield* DiscordHandlerTag;
  const config = yield* store.get;

  if (config.clanTags.length > 0) {
    yield* clash.addClans(config.clanTags);
  }

  yield* discord.login();
  yield* cycleMidnightRestart;
});

const logger = createLogger({ exception: false, rejection: false });

const MainLayer = EventHandlerLayer.pipe(
  Layer.provideMerge(DiscordHandlerLayer),
  Layer.provideMerge(CommandHandlerLayer),
  Layer.provideMerge(MemberHandlerLayer),
  Layer.provideMerge(ClashLayer),
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
  Layer.provideMerge(
    Layer.mergeAll(
      EnvLayer,
      HttpClientLayer,
      ConfigStoreLayer,
      SessionStoreLayer,
      SqliteClientLayer(sqliteConfig),
      UserDatabaseLayer,
      AccountDatabaseLayer,
    ),
  ),
);

runForkWithCleanUp(cycleWithRestart(program.pipe(Effect.provide(MainLayer))).pipe(Effect.provide(LoggerClientLayer(Logger.defaultLogger, logger))));
