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

export const EventHandler = Effect.gen(function* (_) {
  const discordService = yield* _(DiscordClientTag);
  const { client: discord } = discordService;
  const { client: clash } = yield* _(ClashClientTag);
  const configStore = yield* _(ConfigStore);
  const sessionStore = yield* _(SessionStore);
  const commandService = yield* _(CommandServiceTag);
  const sqlite = yield* _(SqliteDatabase);

  // Cache for per-clan offline stores
  const clanStores = new Map<string, Store<any>>();

  const onReady = Effect.gen(function* (_) {
    discordService.clearLoginTimeout();
    yield* _(Effect.logInfo('Bot has started, status set to idle.'));
    const text = [
      'Bot has started,',
      `${discord.users.cache.size} users,`,
      `${discord.channels.cache.size} channels,`,
      `${discord.guilds.cache.size} guilds.`,
    ];
    yield* _(Effect.logInfo(text.join(' ')));
  });

  const onMessageCreate = (message: Message) =>
    Effect.gen(function* (_) {
      if (message.webhookId !== null || message.system || message.author.bot) return;

      yield* _(Effect.logInfo(`${message.author.tag}: ${message.content}`));

      const config = yield* _(configStore.get);
      if (discordService.isMaintenance && !config.ownerIds.includes(message.author.id)) {
        yield* _(Effect.tryPromise(() => message.reply('⚠️ Under Maintenance!')));
        return;
      }

      yield* _(
        commandService.handleCommand(message as Message<true>).pipe(
          Effect.catchAllCause((cause) =>
            Effect.gen(function* (_) {
              yield* _(Effect.logFatal('UnhandledRejection.', cause));
            }),
          ),
        ),
      );
    });

  // Queue for processing leaving members to avoid blocking the main event loop
  const leavingQueue = yield* _(Queue.unbounded<any>());

  const leavingWorker = Effect.forever(
    Effect.gen(function* (_) {
      const player = yield* _(Queue.take(leavingQueue));
      yield* _(
        handleMemberLeave(player).pipe(Effect.catchAllCause((cause) => Effect.logError(`Error processing leaving member ${player.tag}`, cause))),
      );
    }),
  );

  // Fork the worker in the global scope (or the scope provided to the layer)
  yield* _(Effect.forkDaemon(leavingWorker));

  // Using a Semaphore to ensure sequential processing of clan member updates
  const updateSemaphore = yield* _(Effect.makeSemaphore(1));

  const onClanMemberUpdate = (oldClan: any, newClan: any) =>
    updateSemaphore.withPermits(1)(
      Effect.gen(function* (_) {
        const session = yield* _(sessionStore.get);

        // Session management for clans
        if (!session.clans.some((r) => r.tag === oldClan.tag)) {
          yield* _(sessionStore.update((s) => ({ ...s, clans: [...s.clans, { name: oldClan.name, tag: oldClan.tag }] })));
        }

        // Dynamic offline storage for each clan
        let clanStore = clanStores.get(oldClan.tag);
        if (!clanStore) {
          // We use a simplified schema for the clan data as we only need members for leave detection
          const ClanSchema = Schema.Struct({
            tag: Schema.String,
            name: Schema.String,
            members: Schema.Array(Schema.Any),
          });
          const store = yield* _(createStore(`sessions/clan/${oldClan.tag}.json`, ClanSchema, oldClan, 60_000));
          clanStores.set(oldClan.tag, store);
          clanStore = store;

          // Sync initial data from the store if it already existed
          oldClan = yield* _(clanStore.get);
        } else {
          // Update the store with the latest "oldClan" data for persistence
          yield* _(clanStore.set(oldClan));
        }

        // Identify members who left
        const leftMembers = oldClan.members.filter((m: any) => !newClan.members.some((nm: any) => nm.tag === m.tag));

        for (const player of leftMembers) {
          yield* _(Queue.offer(leavingQueue, player));
        }
      }),
    );

  const handleMemberLeave = (player: any) =>
    Effect.gen(function* (_) {
      const config = yield* _(configStore.get);
      const account = yield* _(AccountAdapter.findOne({ tag: player.tag }));

      if (!account || !account.userId) {
        yield* _(Effect.logInfo(`${player.tag}: Unregistered player left clan.`));
        return;
      }

      yield* _(Effect.logInfo(`${player.tag}: Registered player left clan.`));

      const user = yield* _(UserAdapter.findOne({ id: account.userId }));
      if (!user) {
        yield* _(Effect.logWarning(`User not found for userId ${account.userId}`));
        return;
      }

      const userAccounts = yield* _(AccountAdapter.find({ userId: user.id }));
      let otherAccountInClan: any = null;

      for (const acc of userAccounts) {
        if (acc.bannedAt || acc.tag === player.tag) continue;
        try {
          const p = yield* _(Effect.tryPromise(() => clash.getPlayer(acc.tag)));
          if (p.clan && config.clanTags.includes(p.clan.tag)) {
            otherAccountInClan = p;
            break;
          }
        } catch (error) {
          // Handle 404
          yield* _(AccountAdapter.update({ ...acc, bannedAt: Date.now() }));
        }
      }

      const memberOpt = yield* _(getGuildMember(user.ownerId));
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
            yield* _(Effect.tryPromise(() => member.setNickname(nickname)));
            yield* _(Effect.logInfo(`${player.tag}: Nick updated ${member.user.displayName} to ${nickname}`));
          } else {
            // Remove both Member roles AND Clan roles (if any)
            const session = yield* _(sessionStore.get);
            const rolesToRemove = member.roles.cache.filter((r) => isMemberRole(r) || isClanRole(r, session.clans));
            yield* _(Effect.tryPromise(() => member.roles.remove(rolesToRemove)));
            const reapplyRole = guild.roles.cache.find((r) => r.name === 'Reapply');
            if (reapplyRole) yield* _(Effect.tryPromise(() => member.roles.add(reapplyRole)));
            yield* _(Effect.logInfo(`${player.tag}: Added Reapply to ${member.user.displayName}`));
          }
        }
      } catch (error) {
        yield* _(Effect.logError(`Failed to update member roles for ${user.ownerId}`, error));
      }
    });

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

  // Clash events integration
  // Explicitly managing a global scope for dynamic stores to resolve the 'Scope' requirement in runFork
  const globalScope = yield* _(Scope.make());

  clash.on('clanMemberUpdate', (o, n) => {
    Effect.runFork(
      onClanMemberUpdate(o, n).pipe(
        Effect.provideService(SqliteDatabase, sqlite),
        Effect.provideService(DiscordClientTag, discordService),
        Effect.provideService(Scope.Scope, globalScope),
        Effect.catchAllCause((cause) =>
          Effect.gen(function* (_) {
            yield* _(Effect.logError('Error in clanMemberUpdate handler', cause));
          }),
        ),
      ),
    );
  });

  // Clash Error Handling
  clash.on('error', (error) => {
    Effect.runFork(
      Effect.gen(function* (_) {
        yield* _(Effect.logError('Clash API Error', error));
      }),
    );
  });

  yield* _(Effect.logInfo('Event handlers registered.'));
});

export const EventHandlerLayer = Layer.effectDiscard(EventHandler);
