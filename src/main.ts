import 'dotenv/config';

import { Effect, Layer, Logger } from 'effect';

import { ClientEvents } from './core/constants';
import { ConfigStoreLayer, ConfigStoreTag, EnvLayer, EnvTag, SessionStoreLayer } from './core/schemas';
import { sqliteConfig } from './database';
import { MemberManagerLayer } from './domain/MemberManager';
import { ClashConfigTag, ClashLayer, ClashTag } from './services/ClashService';
import { SqliteLayer } from './services/database';
import { HttpLayer } from './services/HttpService';
import { createLogger, LoggerLayer } from './services/LoggerService';
import { cycleMidnightRestart, cycleWithRestart, runForkWithCleanUp } from './services/RuntimeService';
import { CommandHandlerLayer } from './workflows/CommandHandler';
import { DiscordHandlerLayer, DiscordHandlerTag } from './workflows/DiscordHandler';
import { EventHandlerLayer } from './workflows/EventHandler';

const program = Effect.gen(function* () {
  const discord = yield* DiscordHandlerTag;
  const { client } = yield* ClashTag;
  const store = yield* ConfigStoreTag;
  const config = yield* store.get;

  if (config.clanTags.length > 0) {
    client.addClans(config.clanTags as string[]);
  }

  client.setClanEvent({ name: ClientEvents.ClanMember, filter: Boolean });

  yield* discord.login();
  yield* cycleMidnightRestart;
});
const logger = createLogger({ exception: false, rejection: false });

const ClashConfigLayer = Layer.effect(
  ClashConfigTag,
  Effect.gen(function* () {
    const env = yield* EnvTag;
    return {
      email: env.CLASH_EMAIL,
      password: env.CLASH_PASSWORD,
    };
  }),
);

const InfraLayer = Layer.mergeAll(EnvLayer, HttpLayer, ConfigStoreLayer, SessionStoreLayer, SqliteLayer(sqliteConfig));

const ServicesLayer = DiscordHandlerLayer.pipe(Layer.merge(CommandHandlerLayer), Layer.merge(MemberManagerLayer), Layer.provideMerge(ClashLayer));

const MainLayer = ServicesLayer.pipe(Layer.provide(ClashConfigLayer), Layer.provide(InfraLayer), Layer.merge(InfraLayer));

const AppLayer = EventHandlerLayer.pipe(Layer.provide(MainLayer), Layer.merge(MainLayer));

const runnable = program.pipe(Effect.provide(AppLayer));

runForkWithCleanUp(cycleWithRestart(runnable.pipe(Effect.scoped)).pipe(Effect.provide(LoggerLayer(Logger.defaultLogger, logger))));
