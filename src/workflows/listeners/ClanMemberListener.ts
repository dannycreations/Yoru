import { Effect, Option, PubSub, Queue, Scope } from 'effect';

import { ClientEvents } from '../../core/constants';
import { ClanData, ClanSchema, SessionStoreTag } from '../../core/schemas';
import { AccountAdapter, UserAdapter } from '../../database';
import { MemberManagerTag } from '../../domain/MemberManager';
import { getGuildMember } from '../../helpers/discord.helper';
import { ClashTag } from '../../services/ClashService';
import { createStore, Store } from '../../services/StoreService';

import type { ClanMember } from 'clashofclans.js';

export const createClanMemberListener = () =>
  Effect.gen(function* () {
    const { events } = yield* ClashTag;
    const sessionStore = yield* SessionStoreTag;
    const memberManager = yield* MemberManagerTag;
    const scope = yield* Effect.scope;

    const clanStores = new Map<string, Store<ClanData>>();
    const pendingLeavers = new Set<string>();
    const leavingQueue = yield* Queue.unbounded<ClanMember>();
    const updateSemaphore = yield* Effect.makeSemaphore(1);

    const handleMemberLeave = (player: ClanMember) =>
      Effect.gen(function* () {
        if (!pendingLeavers.has(player.tag)) return;

        const account = yield* AccountAdapter.findOne({ tag: player.tag });

        if (!account || !account.userId) {
          pendingLeavers.delete(player.tag);
          return;
        }

        const user = yield* UserAdapter.findOne({ id: account.userId });
        if (!user) {
          pendingLeavers.delete(player.tag);
          return;
        }

        const userAccounts = yield* AccountAdapter.find({ userId: user.id });
        const otherAccountInClan = yield* memberManager.findActiveAccount(user.id, player.tag);
        const memberOpt = yield* getGuildMember(user.ownerId);

        if (Option.isSome(memberOpt)) {
          yield* memberManager.updatePresence(memberOpt.value, otherAccountInClan);
          for (const acc of userAccounts) pendingLeavers.delete(acc.tag);
        }
      });

    yield* Effect.forkDaemon(
      Effect.forever(
        Effect.gen(function* () {
          const player = yield* Queue.take(leavingQueue);
          yield* handleMemberLeave(player).pipe(
            Effect.catchAllCause((cause) => Effect.logError(`Error processing leaving member ${player.tag}`, cause)),
          );
        }),
      ),
    );

    const onClanMemberUpdate = (oldClan: ClanData, newClan: ClanData) =>
      updateSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const session = yield* sessionStore.get;
          if (!session.clans.some((r) => r.tag === oldClan.tag)) {
            yield* sessionStore.update((s) => ({ ...s, clans: [...s.clans, { name: oldClan.name, tag: oldClan.tag }] }));
          }

          let clanStore = clanStores.get(oldClan.tag);
          if (!clanStore) {
            clanStore = yield* createStore(`sessions/clan/${oldClan.tag}.json`, ClanSchema, oldClan, 60_000).pipe(
              Effect.provideService(Scope.Scope, scope),
            );
            clanStores.set(oldClan.tag, clanStore);
          }

          const storedClan = yield* clanStore.get;
          const newMemberTags = new Set(newClan.members.map((m) => m.tag));
          const leftMembers = storedClan.members.filter((m) => !newMemberTags.has(m.tag));

          for (const player of leftMembers) {
            if (!pendingLeavers.has(player.tag)) {
              pendingLeavers.add(player.tag);
              yield* Queue.offer(leavingQueue, player);
            }
          }

          yield* clanStore.set(newClan);
        }),
      );

    yield* PubSub.subscribe(events).pipe(
      Effect.flatMap((queue) =>
        Effect.gen(function* () {
          while (true) {
            const event = yield* queue.take;
            if (event._tag === ClientEvents.ClanMember) {
              // The event handler is executed within a dedicated loop to ensure that clan member updates are processed sequentially and do not interfere with other system events.
              yield* onClanMemberUpdate(event.oldClan as any, event.newClan as any).pipe(
                Effect.catchAllCause((cause) => Effect.logError('Error in ClanMemberUpdate handler', cause)),
              );
            }
          }
        }),
      ),
      Effect.forkDaemon,
    );
  });
