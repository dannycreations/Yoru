import { Events } from '@sapphire/framework';
import { ActivityType, GuildMember } from 'discord.js';
import { Effect, Layer, Option, Queue, Schema, Scope } from 'effect';

import { getGuildMember } from '../helpers/discord.helper';
import { isClanRole, isMemberRole, isModeratorRole } from '../helpers/role.helper';
import { ClashClientTag } from '../services/ClashService';
import { ConfigStore, SessionStore } from '../services/ConfigService';
import { AccountAdapter, SqliteDatabase, UserAdapter } from '../services/database';
import { createStore, Store } from '../services/StoreService';
import { CommandServiceTag } from '../workflows/CommandService';
import { DiscordClientTag } from '../workflows/DiscordService';

import type { Message } from 'discord.js';

export const EventHandler = Effect.gen(function* () {
  const discordService = yield* DiscordClientTag;
  const { client: discord } = discordService;
  const { client: clash } = yield* ClashClientTag;
  const configStore = yield* ConfigStore;
  const sessionStore = yield* SessionStore;
  const commandService = yield* CommandServiceTag;
  const sqlite = yield* SqliteDatabase;

  const clanStores = new Map<string, Store<any>>();

  const onReady = Effect.gen(function* () {
    discordService.clearLoginTimeout();
    yield* Effect.logInfo('Bot has started, status set to idle.');
    const text = [
      'Bot has started,',
      `${discord.users.cache.size} users,`,
      `${discord.channels.cache.size} channels,`,
      `${discord.guilds.cache.size} guilds.`,
    ];
    yield* Effect.logInfo(text.join(' '));
  });

  const onMessageCreate = (message: Message) =>
    Effect.gen(function* () {
      if (message.webhookId !== null || message.system || message.author.bot) return;

      yield* Effect.logInfo(`${message.author.tag}: ${message.content}`);

      const config = yield* configStore.get;
      if (discordService.isMaintenance && !config.ownerIds.includes(message.author.id)) {
        yield* Effect.tryPromise(() => message.reply('⚠️ Under Maintenance!'));
        return;
      }

      yield* commandService.handleCommand(message as Message<true>).pipe(
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logFatal('UnhandledRejection.', cause);
          }),
        ),
      );
    });

  const handleMemberLeave = (player: any) =>
    Effect.gen(function* () {
      const config = yield* configStore.get;
      const account = yield* AccountAdapter.findOne({ tag: player.tag });

      if (!account || !account.userId) {
        yield* Effect.logInfo(`${player.tag}: Unregistered player left clan.`);
        return;
      }

      yield* Effect.logInfo(`${player.tag}: Registered player left clan.`);

      const user = yield* UserAdapter.findOne({ id: account.userId });
      if (!user) {
        yield* Effect.logWarning(`User not found for userId ${account.userId}`);
        return;
      }

      const userAccounts = yield* AccountAdapter.find({ userId: user.id });
      let otherAccountInClan: any = null;

      for (const acc of userAccounts) {
        if (acc.bannedAt || acc.tag === player.tag) continue;
        try {
          const p = yield* Effect.tryPromise(() => clash.getPlayer(acc.tag));
          if (p.clan && config.clanTags.includes(p.clan.tag)) {
            otherAccountInClan = p;
            break;
          }
        } catch (error) {
          if (error && typeof error === 'object' && 'reason' in error && error.reason === 'notFound') {
            yield* AccountAdapter.update({ ...acc, bannedAt: Date.now() });
          }
        }
      }

      const memberOpt = yield* getGuildMember(user.ownerId);
      if (Option.isNone(memberOpt)) return;

      const member = memberOpt.value;
      const guild = member.guild;

      try {
        if (member instanceof GuildMember && !member.roles.cache.some(isModeratorRole)) {
          if (otherAccountInClan) {
            const nickname =
              member.user.username.toLowerCase() === otherAccountInClan.name.toLowerCase()
                ? `${otherAccountInClan.name} ${otherAccountInClan.tag}`
                : otherAccountInClan.name;
            yield* Effect.tryPromise(() => member.setNickname(nickname));
            yield* Effect.logInfo(`${player.tag}: Nick updated ${member.user.displayName} to ${nickname}`);
          } else {
            const session = yield* sessionStore.get;
            const rolesToRemove = member.roles.cache.filter((r) => isMemberRole(r) || isClanRole(r, session.clans));
            yield* Effect.tryPromise(() => member.roles.remove(rolesToRemove));
            const reapplyRole = guild.roles.cache.find((r) => r.name === 'Reapply');
            if (reapplyRole) yield* Effect.tryPromise(() => member.roles.add(reapplyRole));
            yield* Effect.logInfo(`${player.tag}: Added Reapply to ${member.user.displayName}`);
          }
        }
      } catch (error) {
        yield* Effect.logError(`Failed to update member roles for ${user.ownerId}`, error);
      }
    });

  const leavingQueue = yield* Queue.unbounded<any>();

  const leavingWorker = Effect.forever(
    Effect.gen(function* () {
      const player = yield* Queue.take(leavingQueue);
      yield* handleMemberLeave(player).pipe(Effect.catchAllCause((cause) => Effect.logError(`Error processing leaving member ${player.tag}`, cause)));
    }),
  );

  yield* Effect.forkDaemon(leavingWorker);

  const updateSemaphore = yield* Effect.makeSemaphore(1);

  const onClanMemberUpdate = (oldClan: any, newClan: any) =>
    updateSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const session = yield* sessionStore.get;

        if (!session.clans.some((r) => r.tag === oldClan.tag)) {
          yield* sessionStore.update((s) => ({ ...s, clans: [...s.clans, { name: oldClan.name, tag: oldClan.tag }] }));
        }

        let clanStore = clanStores.get(oldClan.tag);
        if (!clanStore) {
          const ClanSchema = Schema.Struct({
            tag: Schema.String,
            name: Schema.String,
            members: Schema.Array(Schema.Any),
          });
          const store = yield* createStore(`sessions/clan/${oldClan.tag}.json`, ClanSchema, oldClan, 60_000);
          clanStores.set(oldClan.tag, store);
          clanStore = store;

          oldClan = yield* clanStore.get;
        } else {
          yield* clanStore.set(oldClan);
        }

        const leftMembers = oldClan.members.filter((m: any) => !newClan.members.some((nm: any) => nm.tag === m.tag));

        for (const player of leftMembers) {
          yield* Queue.offer(leavingQueue, player);
        }
      }),
    );

  discord.once(Events.ClientReady, (c) => {
    Effect.runFork(onReady.pipe(Effect.provideService(DiscordClientTag, discordService), Effect.provideService(ConfigStore, configStore)));
    c.user.setPresence({
      status: 'idle',
      activities: [{ name: 'Clash of Clans', type: ActivityType.Playing }],
    });
  });

  discord.on(Events.MessageCreate, (m) => {
    Effect.runFork(onMessageCreate(m).pipe(Effect.provideService(SqliteDatabase, sqlite), Effect.provideService(DiscordClientTag, discordService)));
  });

  const globalScope = yield* Scope.make();

  clash.on('clanMemberUpdate', (o, n) => {
    Effect.runFork(
      onClanMemberUpdate(o, n).pipe(
        Effect.provideService(SqliteDatabase, sqlite),
        Effect.provideService(DiscordClientTag, discordService),
        Effect.provideService(Scope.Scope, globalScope),
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError('Error in clanMemberUpdate handler', cause);
          }),
        ),
      ),
    );
  });

  clash.on('error', (error) => {
    Effect.runFork(
      Effect.gen(function* () {
        yield* Effect.logError('Clash API Error', error);
      }),
    );
  });

  yield* Effect.logInfo('Event handlers registered.');
});

export const EventHandlerLayer = Layer.effectDiscard(EventHandler);
