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

        const cleanupLeaver = (tags: ReadonlyArray<string>) => {
          const tagSet = new Set(tags);
          return sessionStore.update((s) => ({
            ...s,
            leavers: (s.leavers ?? []).filter((t) => !tagSet.has(t)),
          }));
        };

        const accountOpt = yield* accountDatabase.findOne({ tag: player.tag });
        const userId = Option.flatMap(accountOpt, (acc) => Option.fromNullable(acc.userId));

        if (Option.isNone(userId)) {
          yield* cleanupLeaver([player.tag]);
          return;
        }

        const userOpt = yield* userDatabase.findOne({ id: userId.value });
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

    yield* Effect.forever(
      Effect.gen(function* () {
        const player = yield* Queue.take(leavingQueue);
        yield* handleMemberLeave(player).pipe(
          Effect.catchAllCause((cause) => Effect.logError(`Error processing leaving member ${player.tag}`, cause)),
        );
      }),
    ).pipe(Effect.forkScoped);

    const onClanMemberUpdate = (oldClan: ClanData, newClan: ClanData) =>
      updateSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const session = yield* sessionStore.get;
          const clans = session.clans ?? [];
          if (!Array.some(clans, (r) => r.tag === oldClan.tag)) {
            yield* sessionStore.update((s) => ({
              ...s,
              clans: Array.append(s.clans ?? [], { name: oldClan.name, tag: oldClan.tag }),
            }));
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
          const newMemberTags = new Set(newClan.members.map((m) => m.tag));
          const leftMembers = storedClan.members.filter((m: ClanMemberTag) => !newMemberTags.has(m.tag));

          if (leftMembers.length > 0) {
            const session = yield* sessionStore.get;
            const currentPending = new Set(session.leavers ?? []);
            const toAdd = leftMembers.filter((m) => !currentPending.has(m.tag));

            if (toAdd.length > 0) {
              yield* Effect.all(
                toAdd.map((m) => Queue.offer(leavingQueue, m)),
                { concurrency: 'inherit' },
              );
              yield* sessionStore.update((s) => ({
                ...s,
                leavers: [...(s.leavers ?? []), ...toAdd.map((m) => m.tag)],
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
              { concurrency: 'inherit' },
            );
          }),
        ),
      ),
      Effect.forkScoped,
    );
  });
