import 'dotenv/config';

import { Effect, Layer, Schedule } from 'effect';

import { EmojiLayer } from './core/emojis.js';
import { ConfigStoreLayer, ConfigStoreTag, EnvLayer, SessionStoreLayer } from './core/schemas.js';
import { AccountDatabaseLayer, SqliteConfigLayer, UserDatabaseLayer } from './database/index.js';
import { ClashClientLayer, ClashClientTag, ClashConfigLayer } from './services/ClashService.js';
import { SqliteClientLayer } from './structures/database/index.js';
import { HttpClientLayer } from './structures/HttpClient.js';
import { LoggerClientLayer } from './structures/LoggerClient.js';
import { cycleUntilMidnight, runMainCycle } from './structures/RuntimeClient.js';
import { CommandHandlerLayer } from './workflows/CommandHandler.js';
import { DiscordHandlerLayer, DiscordHandlerTag } from './workflows/DiscordHandler.js';
import { EventHandlerLayer } from './workflows/EventHandler.js';
import { MemberHandlerLayer } from './workflows/MemberHandler.js';

const program = Effect.gen(function* () {
  const clash = yield* ClashClientTag;
  const store = yield* ConfigStoreTag;
  const discord = yield* DiscordHandlerTag;
  const config = yield* store.get;

  if (config.clanTags.length > 0) {
    yield* clash.addClans(config.clanTags);
  }

  yield* discord.login().pipe(
    Effect.retry({
      schedule: Schedule.exponential('1 seconds'),
      while: (error) => error._tag === 'DiscordError',
    }),
  );
  return yield* cycleUntilMidnight;
});

const logger = LoggerClientLayer();

const BaseLayer = Layer.mergeAll(EnvLayer, EmojiLayer, HttpClientLayer, ConfigStoreLayer, SessionStoreLayer, logger).pipe(
  Layer.provideMerge(UserDatabaseLayer),
  Layer.provideMerge(AccountDatabaseLayer),
  Layer.provideMerge(SqliteClientLayer),
  Layer.provideMerge(SqliteConfigLayer),
);

const MainLayer = EventHandlerLayer.pipe(
  Layer.provideMerge(DiscordHandlerLayer),
  Layer.provideMerge(CommandHandlerLayer),
  Layer.provideMerge(MemberHandlerLayer),
  Layer.provideMerge(ClashClientLayer),
  Layer.provideMerge(ClashConfigLayer),
);

runMainCycle(program.pipe(Effect.provide(MainLayer.pipe(Layer.provideMerge(BaseLayer)))), { logger });
