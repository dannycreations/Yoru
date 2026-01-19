import { Array, Effect, Option, PubSub, Queue, Ref, Scope } from 'effect';

import { ClientEvents } from '../../core/constants';
import { ClanData, ClanSchema, SessionStoreTag } from '../../core/schemas';
import { AccountDatabaseTag, UserDatabaseTag } from '../../database';
import { getGuildMember } from '../../helpers/DiscordHelper';
import { ClashClientTag } from '../../services/ClashService';
import { makeStoreClient, StoreClient } from '../../structures/StoreClient';
import { MemberHandlerTag } from '../MemberHandler';

import type { ClanMember } from 'clashofclans.js';

type ClanMemberTag = Pick<ClanMember, 'name' | 'tag'>;

export const createClanMemberListener = () =>
  Effect.gen(function* () {
    const { events } = yield* ClashClientTag;
    const sessionStore = yield* SessionStoreTag;
    const memberHandler = yield* MemberHandlerTag;
    const accountDatabase = yield* AccountDatabaseTag;
    const userDatabase = yield* UserDatabaseTag;
    const scope = yield* Effect.scope;

    const clanStoresRef = yield* Ref.make(new Map<string, StoreClient<ClanData>>());
    const leavingQueue = yield* Queue.unbounded<ClanMemberTag>();
    const updateSemaphore = yield* Effect.makeSemaphore(1);

    const handleMemberLeave = (player: ClanMemberTag) =>
      Effect.gen(function* () {
        const session = yield* sessionStore.get;
        const leavers = session.leavers ?? [];
        if (!leavers.includes(player.tag)) return;

        const cleanupLeaver = (tags: ReadonlyArray<string>) =>
          sessionStore.update((s) => ({
            ...s,
            leavers: (s.leavers ?? []).filter((t) => !tags.includes(t)),
          }));

        const accountOpt = yield* accountDatabase.findOne({ tag: player.tag });
        if (Option.isNone(accountOpt) || !accountOpt.value.userId) {
          yield* cleanupLeaver([player.tag]);
          return;
        }

        const userOpt = yield* userDatabase.findOne({ id: accountOpt.value.userId });
        if (Option.isNone(userOpt)) {
          yield* cleanupLeaver([player.tag]);
          return;
        }

        const user = userOpt.value;
        const userAccounts = yield* accountDatabase.find({ userId: user.id });
        const otherAccountInClan = yield* memberHandler.findActiveAccount(user.id, player.tag);
        const memberOpt = yield* getGuildMember(user.ownerId);

        if (Option.isSome(memberOpt)) {
          yield* memberHandler.updatePresence(memberOpt.value, otherAccountInClan);
          yield* cleanupLeaver(Array.map(userAccounts, (acc) => acc.tag));
        }
      });

    yield* Effect.fork(
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
          const clans = session.clans ?? [];
          if (!clans.some((r) => r.tag === oldClan.tag)) {
            yield* sessionStore.update((s) => ({ ...s, clans: [...(s.clans ?? []), { name: oldClan.name, tag: oldClan.tag }] }));
          }

          const clanStores = yield* Ref.get(clanStoresRef);
          const clanStore = clanStores.get(oldClan.tag);
          const currentStore =
            clanStore ??
            (yield* makeStoreClient(`sessions/clan/${oldClan.tag}.json`, ClanSchema, oldClan, 60_000).pipe(
              Effect.provideService(Scope.Scope, scope),
              Effect.tap((s) => Ref.set(clanStoresRef, new Map(clanStores).set(oldClan.tag, s))),
            ));

          const storedClan = yield* currentStore.get;
          const newMemberTags = new Set(Array.map(newClan.members, (m) => m.tag));
          const leftMembers = Array.filter(storedClan.members, (m: ClanMemberTag) => !newMemberTags.has(m.tag));

          if (leftMembers.length > 0) {
            const session = yield* sessionStore.get;
            const currentPending = new Set(session.leavers ?? []);
            const toAdd = leftMembers.filter((m: ClanMemberTag) => !currentPending.has(m.tag));

            if (toAdd.length > 0) {
              yield* Effect.all(Array.map(toAdd, (m: ClanMemberTag) => Queue.offer(leavingQueue, m)));
              yield* sessionStore.update((s) => ({
                ...s,
                leavers: [...(s.leavers ?? []), ...Array.map(toAdd, (m: ClanMemberTag) => m.tag)],
              }));
            }
          }

          yield* currentStore.set(newClan);
        }),
      );

    yield* PubSub.subscribe(events).pipe(
      Effect.flatMap((queue) =>
        Effect.forever(
          Effect.gen(function* () {
            const events = yield* Queue.takeAll(queue);
            yield* Effect.forEach(
              events,
              (event) =>
                Effect.gen(function* () {
                  if (event._tag === ClientEvents.ClanMember) {
                    yield* onClanMemberUpdate(event.oldClan, event.newClan).pipe(
                      Effect.catchAllCause((cause) => Effect.logError('Error in ClanMemberUpdate handler', cause)),
                    );
                  }
                }),
              { concurrency: 'unbounded' },
            );
          }),
        ),
      ),
      Effect.fork,
    );
  });
