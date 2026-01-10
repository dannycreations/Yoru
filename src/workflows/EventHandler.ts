import { Events } from '@sapphire/framework';
import { isErrorLike } from '@vegapunk/utilities/result';
import { PollingEvents } from 'clashofclans.js';
import { ActivityType, GuildMember } from 'discord.js';
import { Effect, Layer, Option, Queue, Runtime, Scope } from 'effect';

import { ClientEvents, RegisterRoles } from '../core/constants';
import { ClanData, ClanSchema, ConfigStoreTag, SessionStoreTag } from '../core/schemas';
import { AccountAdapter, UserAdapter } from '../database';
import { getGuildMember } from '../helpers/discord.helper';
import { isClanRole, isMemberRole, isModeratorRole } from '../helpers/role.helper';
import { ClashTag } from '../services/ClashService';
import { SqliteTag } from '../services/database';
import { createStore, Store } from '../services/StoreService';
import { CommandHandlerTag } from './CommandHandler';
import { DiscordHandlerTag } from './DiscordHandler';

import type { ClanMember, Player } from 'clashofclans.js';
import type { Message } from 'discord.js';
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

  // Capture the current runtime to preserve environment (services, logger, etc.) in callbacks.
  const runtime = yield* Effect.runtime<SqliteTag | DiscordHandler | ConfigStoreTag | SessionStoreTag | CommandHandler | ClashLayer | Scope.Scope>();
  const scope = yield* Effect.scope;

  // Map to store clan-specific data persistent stores.
  const clanStores = new Map<string, Store<ClanData>>();

  // Set to track player tags currently pending in the leaving queue.
  const pendingLeavers = new Set<string>();

  const onReady = Effect.gen(function* () {
    // Allowing the asynchronous initialization logs from Sapphire to be printed first.
    yield* Effect.sleep(1000);
    discordHandler.clearLoginTimeout();
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
      // Ignore system messages, webhooks, and bot messages.
      if (message.webhookId !== null || message.system || message.author.bot) return;

      yield* Effect.logInfo(`${message.author.tag}: ${message.content}`);

      const config = yield* configStore.get;
      // Maintenance mode check.
      if (discordHandler.isMaintenance && !config.ownerIds.includes(message.author.id)) {
        yield* Effect.tryPromise(() => message.reply('⚠️ Under Maintenance!'));
        return;
      }

      // Delegate command handling to CommandService.
      yield* commandService.handleCommand(message as Message<true>).pipe(
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logFatal('UnhandledRejection.', cause);
          }),
        ),
      );
    });

  const handleMemberLeave = (player: ClanMember) =>
    Effect.gen(function* () {
      // Check if this player is still marked as pending.
      // If not, it means they were removed because another account of the same user was already processed.
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
        yield* Effect.logWarning(`User not found for userId ${account.userId}`);
        return;
      }

      const userAccounts = yield* AccountAdapter.find({ userId: user.id });

      // Remove all accounts of this user from the pending leavers set
      // to avoid redundant processing for the same user.
      for (const acc of userAccounts) {
        pendingLeavers.delete(acc.tag);
      }

      // Efficiently check if the user has any other accounts still in a monitored clan.
      // We use Effect.all with concurrency to fetch multiple player profiles in parallel,
      // which is significantly faster than sequential await in a loop.
      const otherAccounts = userAccounts.filter((acc) => !acc.bannedAt && acc.tag !== player.tag);
      const playerResults = yield* Effect.all(
        otherAccounts.map((acc) =>
          Effect.tryPromise(() => clash.getPlayer(acc.tag)).pipe(
            Effect.flatMap((p) =>
              p.clan && config.clanTags.includes(p.clan.tag) ? Effect.succeed(Option.some(p)) : Effect.succeed(Option.none<Player>()),
            ),
            Effect.catchAll((error) => {
              // If a player is not found, mark it as banned in the database to prevent future redundant API calls.
              if (isErrorLike<{ reason: string }>(error) && error.reason === 'notFound') {
                return AccountAdapter.update({ ...acc, bannedAt: Date.now() }).pipe(Effect.as(Option.none<Player>()));
              }
              return Effect.succeed(Option.none<Player>());
            }),
          ),
        ),
        { concurrency: 5 }, // Limit concurrency to avoid overwhelming the API or network.
      );

      const otherAccountInClan = playerResults.find(Option.isSome)?.value ?? null;

      const memberOpt = yield* getGuildMember(user.ownerId);
      if (Option.isNone(memberOpt)) return;

      const member = memberOpt.value;
      const guild = member.guild;

      try {
        // Only update roles if the member is still in the server and not a moderator.
        if (member instanceof GuildMember && !member.roles.cache.some(isModeratorRole)) {
          if (otherAccountInClan) {
            // User still has another account in a clan: update nickname to that account.
            const nickname =
              member.user.username.toLowerCase() === otherAccountInClan.name.toLowerCase()
                ? `${otherAccountInClan.name} ${otherAccountInClan.tag}`
                : otherAccountInClan.name;
            yield* Effect.tryPromise(() => member.setNickname(nickname));
            yield* Effect.logInfo(`${player.tag}: Nick updated ${member.user.displayName} to ${nickname}`);
          } else {
            // No accounts left in clans: remove clan roles and add 'Reapply' role.
            const session = yield* sessionStore.get;
            const rolesToRemove = member.roles.cache.filter((r) => isMemberRole(r) || isClanRole(r, session.clans));
            yield* Effect.tryPromise(() => member.roles.remove(rolesToRemove));
            const reapplyRole = guild.roles.cache.find((r) => r.name === RegisterRoles.Reapply);
            if (reapplyRole) yield* Effect.tryPromise(() => member.roles.add(reapplyRole));
            yield* Effect.logInfo(`${player.tag}: Added Reapply to ${member.user.displayName}`);
          }
        }
      } catch (error) {
        yield* Effect.logError(`Failed to update member roles for ${user.ownerId}`, error);
      }
    });

  // Queue for processing members who left a clan.
  // We use a ClanMember type here as it's what we get from the clan member list.
  const leavingQueue = yield* Queue.unbounded<ClanMember>();

  const leavingWorker = Effect.forever(
    Effect.gen(function* () {
      const player = yield* Queue.take(leavingQueue);
      yield* handleMemberLeave(player).pipe(Effect.catchAllCause((cause) => Effect.logError(`Error processing leaving member ${player.tag}`, cause)));
    }),
  );

  // Run the worker in a separate fiber.
  yield* Effect.forkDaemon(leavingWorker);

  // Semaphore to ensure clan member updates are processed sequentially per clan.
  const updateSemaphore = yield* Effect.makeSemaphore(1);

  const onClanMemberUpdate = (oldClan: ClanData, newClan: ClanData) =>
    updateSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const session = yield* sessionStore.get;

        // Ensure the clan is registered in the session store for role management purposes.
        if (!session.clans.some((r) => r.tag === oldClan.tag)) {
          yield* sessionStore.update((s) => ({ ...s, clans: [...s.clans, { name: oldClan.name, tag: oldClan.tag }] }));
        }

        // Load or create a persistent store for the clan's member list to track state across restarts.
        let clanStore = clanStores.get(oldClan.tag);
        if (!clanStore) {
          const store = yield* createStore(`sessions/clan/${oldClan.tag}.json`, ClanSchema, oldClan, 60_000).pipe(
            Effect.provideService(Scope.Scope, scope),
          );
          clanStores.set(oldClan.tag, store);
          clanStore = store;

          oldClan = yield* clanStore.get;
        }

        // Identify members who were in the old state but are not in the new state.
        const leftMembers = oldClan.members.filter((m) => !newClan.members.some((nm) => nm.tag === m.tag));

        // Queue each leaving member for processing and remove them from the 'old' state if they are confirmed gone.
        for (const player of leftMembers) {
          if (!pendingLeavers.has(player.tag)) {
            pendingLeavers.add(player.tag);
            yield* Queue.offer(leavingQueue, player);
          }
        }

        // Update the store with the latest clan state (newClan) for the next comparison.
        yield* clanStore.set(newClan);
      }),
    );

  // Register Discord event listeners.
  discord.once(Events.ClientReady, (c) => {
    Runtime.runFork(runtime)(onReady);
    c.user.setPresence({
      status: 'idle',
      activities: [{ name: 'Clash of Clans', type: ActivityType.Playing }],
    });
  });

  discord.on(Events.MessageCreate, (m) => {
    Runtime.runFork(runtime)(
      onMessageCreate(m).pipe(
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError('Unhandled error in MessageCreate handler', cause);
          }),
        ),
      ),
    );
  });

  // Register Clash API event listeners.
  clash.on(ClientEvents.ClanMember, (o, n) => {
    Runtime.runFork(runtime)(
      onClanMemberUpdate(o, n).pipe(
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError('Error in clanMemberUpdate handler', cause);
          }),
        ),
      ),
    );
  });

  clash.on(PollingEvents.Error, (error) => {
    Runtime.runFork(runtime)(
      Effect.gen(function* () {
        yield* Effect.logError('Clash API Error', error);
      }),
    );
  });
});

export const EventHandlerLayer = Layer.effectDiscard(EventHandler);
