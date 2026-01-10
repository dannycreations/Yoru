import { Events } from '@sapphire/framework';
import { isErrorLike } from '@vegapunk/utilities/result';
import { PollingEvents } from 'clashofclans.js';
import { ActivityType, GuildMember } from 'discord.js';
import { Effect, Layer, Option, Queue, Runtime, Scope } from 'effect';

import { ClientEvents, RegisterRoles } from '../core/constants';
import { ClanData, ClanSchema, ConfigStoreTag, SessionStoreTag } from '../core/schemas';
import { AccountAdapter, UserAdapter } from '../database';
import { getPlayerNickname } from '../helpers/clash.helper';
import { getGuildMember } from '../helpers/discord.helper';
import { isClanRole, isMemberRole, isModeratorRole } from '../helpers/role.helper';
import { ClashTag } from '../services/ClashService';
import { SqliteTag } from '../services/database';
import { createStore, Store } from '../services/StoreService';
import { CommandHandlerTag } from './CommandHandler';
import { DiscordHandlerTag } from './DiscordHandler';

import type { SapphireClient } from '@sapphire/framework';
import type { ClanMember, Player } from 'clashofclans.js';
import type { Message } from 'discord.js';
import type { AccountTable } from '../database/schema';
import type { ClashLayer } from '../services/ClashService';
import type { CommandHandler } from './CommandHandler';
import type { DiscordHandler } from './DiscordHandler';

export const EventHandler = Effect.gen(function* () {
  const discordHandler = yield* DiscordHandlerTag;
  const { client: discord } = discordHandler;
  const { client: clash } = yield* ClashTag;
  const configStore = yield* ConfigStoreTag;
  const sessionStore = yield* SessionStoreTag;
  const commandService = yield* CommandHandlerTag;

  // The current runtime is captured to preserve the execution environment, including services and loggers, for use within callbacks.
  const runtime = yield* Effect.runtime<SqliteTag | DiscordHandler | ConfigStoreTag | SessionStoreTag | CommandHandler | ClashLayer | Scope.Scope>();
  const scope = yield* Effect.scope;

  // A registry of persistent stores for each monitored clan ensures data continuity across application restarts.
  const clanStores = new Map<string, Store<ClanData>>();

  // Player tags undergoing the departure process are tracked to prevent redundant event processing.
  const pendingLeavers = new Set<string>();

  // Successful connections trigger an update to the client's presence to indicate that the service is active.
  const onReady = (client: SapphireClient<true>) =>
    Effect.gen(function* () {
      // A one-second delay allows asynchronous initialization logs from Sapphire to be printed before signaling readiness.
      yield* Effect.sleep(1000);
      discordHandler.clearLoginTimeout();

      client.user.setPresence({
        status: 'idle',
        activities: [{ name: 'Clash of Clans', type: ActivityType.Playing }],
      });

      const stats = [`${client.users.cache.size} users`, `${client.channels.cache.size} channels`, `${client.guilds.cache.size} guilds`];
      yield* Effect.logInfo(`Bot has started with ${stats.join(', ')}.`);
    });

  // Incoming messages are filtered to exclude bots and system messages before being delegated to the command handler under normal operating conditions.
  const onMessageCreate = (message: Message) =>
    Effect.gen(function* () {
      if (message.webhookId !== null || message.system || message.author.bot) return;

      yield* Effect.logInfo(`${message.author.tag}: ${message.content}`);

      const config = yield* configStore.get;
      if (discordHandler.isMaintenance && !config.ownerIds.includes(message.author.id)) {
        yield* Effect.tryPromise(() => message.reply('⚠️ Under Maintenance!'));
        return;
      }

      yield* commandService
        .handleCommand(message as Message<true>)
        .pipe(Effect.catchAllCause((cause) => Effect.logFatal('Unhandled rejection in command handler.', cause)));
    });

  // Identification of at least one active account in a monitored clan determines whether a user's member status is preserved.
  const findActiveAccountInClan = (userAccounts: AccountTable[], currentTag: string, clanTags: readonly string[]) =>
    Effect.gen(function* () {
      const otherAccounts = userAccounts.filter((acc) => !acc.bannedAt && acc.tag !== currentTag);

      for (const account of otherAccounts) {
        const result = yield* Effect.tryPromise(() => clash.getPlayer(account.tag)).pipe(
          Effect.map((p) => (p.clan && clanTags.includes(p.clan.tag) ? p : null)),
          Effect.catchAll((error) => {
            // Accounts missing from the API are marked as banned under the assumption of deletion or permanent disability.
            if (isErrorLike<{ reason: string }>(error) && error.reason === 'notFound') {
              return AccountAdapter.update({ ...account, bannedAt: Date.now() }).pipe(Effect.as(null));
            }
            return Effect.succeed(null);
          }),
        );

        if (result) return result;
      }

      return null;
    });

  // Discord member states are synchronized with their clan affiliation by adjusting roles and nicknames to maintain server organization.
  const updateMemberPresence = (member: GuildMember, otherAccountInClan: Player | null) =>
    Effect.gen(function* () {
      if (member.roles.cache.some(isModeratorRole)) return;

      const guild = member.guild;
      if (otherAccountInClan) {
        // Nickname generation is delegated to a centralized helper to maintain consistency across different interaction points.
        const nickname = getPlayerNickname(member, otherAccountInClan);
        yield* Effect.tryPromise(() => member.setNickname(nickname));
        yield* Effect.logInfo(`${member.user.tag}: Nickname updated to reflect active account ${otherAccountInClan.tag}`);
      } else {
        // Absence of active accounts in monitored clans results in the removal of clan-specific roles and the assignment of the reapply role.
        const session = yield* sessionStore.get;
        const rolesToRemove = member.roles.cache.filter((r) => isMemberRole(r) || isClanRole(r, session.clans));
        // Removing all clan-related roles in a single operation minimizes the number of API calls to Discord and ensures atomic state transitions for members.
        if (rolesToRemove.size > 0) yield* Effect.tryPromise(() => member.roles.remove(rolesToRemove));

        const reapplyRole = guild.roles.cache.find((r) => r.name === RegisterRoles.Reapply);
        if (reapplyRole) yield* Effect.tryPromise(() => member.roles.add(reapplyRole));
        yield* Effect.logInfo(`${member.user.tag}: Clan roles removed and Reapply role added`);
      }
    }).pipe(Effect.catchAll((error) => Effect.logError(`Failed to update Discord presence for ${member.id}`, error)));

  // The lifecycle of a member's departure is managed through database updates and Discord role synchronization.
  const handleMemberLeave = (player: ClanMember) =>
    Effect.gen(function* () {
      if (!pendingLeavers.has(player.tag)) return;

      const config = yield* configStore.get;
      const account = yield* AccountAdapter.findOne({ tag: player.tag });

      if (!account || !account.userId) {
        pendingLeavers.delete(player.tag);
        yield* Effect.logInfo(`${player.tag}: Unregistered player left clan.`);
        return;
      }

      yield* Effect.logInfo(`${player.tag}: Registered player left clan.`);

      const user = yield* UserAdapter.findOne({ id: account.userId });
      if (!user) {
        pendingLeavers.delete(player.tag);
        yield* Effect.logWarning(`User record missing for linked account ${player.tag}`);
        return;
      }

      const userAccounts = yield* AccountAdapter.find({ userId: user.id });

      const otherAccountInClan = yield* findActiveAccountInClan(userAccounts, player.tag, config.clanTags);
      const memberOpt = yield* getGuildMember(user.ownerId);

      if (Option.isSome(memberOpt)) {
        yield* updateMemberPresence(memberOpt.value, otherAccountInClan);

        // Departure tracking for all accounts associated with a user is cleared to avoid redundant processing of multiple departures.
        for (const acc of userAccounts) {
          pendingLeavers.delete(acc.tag);
        }
      }
    });

  // An unbounded queue processes members who have left a clan.
  // The ClanMember type is utilized as it represents the data structure provided by the clan member list.
  const leavingQueue = yield* Queue.unbounded<ClanMember>();

  const leavingWorker = Effect.forever(
    Effect.gen(function* () {
      const player = yield* Queue.take(leavingQueue);
      yield* handleMemberLeave(player).pipe(Effect.catchAllCause((cause) => Effect.logError(`Error processing leaving member ${player.tag}`, cause)));
    }),
  );

  // The leaving worker runs in a separate fiber to handle departures asynchronously.
  yield* Effect.forkDaemon(leavingWorker);

  // A semaphore ensures that clan member updates are processed sequentially for each clan.
  const updateSemaphore = yield* Effect.makeSemaphore(1);

  // Clan metadata is synchronized with the session store to enable accurate role identification across the system.
  const syncClanSession = (clan: ClanData) =>
    Effect.gen(function* () {
      const session = yield* sessionStore.get;
      if (!session.clans.some((r) => r.tag === clan.tag)) {
        yield* sessionStore.update((s) => ({ ...s, clans: [...s.clans, { name: clan.name, tag: clan.tag }] }));
      }
    });

  // Individual persistent stores for each clan track member changes over time and survive application restarts.
  const getClanStore = (clan: ClanData) =>
    Effect.gen(function* () {
      let clanStore = clanStores.get(clan.tag);
      if (!clanStore) {
        clanStore = yield* createStore(`sessions/clan/${clan.tag}.json`, ClanSchema, clan, 60_000).pipe(Effect.provideService(Scope.Scope, scope));
        clanStores.set(clan.tag, clanStore);
      }
      return clanStore;
    });

  // Clan member updates are processed by comparing the incoming API state with the local persistent state to detect departures.
  const onClanMemberUpdate = (oldClan: ClanData, newClan: ClanData) =>
    updateSemaphore.withPermits(1)(
      Effect.gen(function* () {
        yield* syncClanSession(oldClan);

        const clanStore = yield* getClanStore(oldClan);
        const storedClan = yield* clanStore.get;

        // Members no longer present in the clan are identified by filtering the stored member list against the latest API data.
        const leftMembers = storedClan.members.filter((m) => !newClan.members.some((nm) => nm.tag === m.tag));

        for (const player of leftMembers) {
          // A tracking set prevents redundant leave processing if multiple updates occur in rapid succession.
          if (!pendingLeavers.has(player.tag)) {
            pendingLeavers.add(player.tag);
            yield* Queue.offer(leavingQueue, player);
          }
        }

        yield* clanStore.set(newClan);
      }),
    );

  // Event listeners are registered using a structured approach that ensures asynchronous handlers execute within the correct Effect runtime.
  // Generic types for the emitter, listener arguments, errors, and requirements provide full type safety.
  const register = <T, A extends unknown[], E, R>(
    emitter: T & {
      on: Function;
      once?: Function;
    },
    event: string,
    handler: (...args: A) => Effect.Effect<void, E, R>,
    once = false,
  ) => {
    const cb = (...args: A) =>
      Runtime.runFork(runtime)(
        Effect.catchAllCause(handler(...args) as Effect.Effect<void, E, never>, (cause) =>
          Effect.logError(`Unhandled error in ${event} handler`, cause),
        ),
      );
    if (once && emitter.once) {
      emitter.once(event, cb);
    } else {
      emitter.on(event, cb);
    }
  };

  register(discord, Events.ClientReady, onReady, true);
  register(discord, Events.MessageCreate, onMessageCreate);
  register(clash, ClientEvents.ClanMember, onClanMemberUpdate);
  register(clash, PollingEvents.Error, (error) => Effect.logError('Clash API Error', error));
});

export const EventHandlerLayer = Layer.effectDiscard(EventHandler);
