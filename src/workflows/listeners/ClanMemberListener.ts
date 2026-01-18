import { Effect, Option, PubSub, Queue, Scope } from 'effect';

import { ClientEvents } from '../../core/constants';
import { ClanData, ClanSchema, ConfigStoreTag, SessionStoreTag } from '../../core/schemas';
import { AccountDatabaseTag, UserDatabaseTag } from '../../database';
import { getGuildMember } from '../../helpers/DiscordHelper';
import { ClashTag } from '../../services/ClashService';
import { SqliteClientTag } from '../../structures/database';
import { makeStoreClient, StoreClient } from '../../structures/StoreClient';
import { DiscordHandlerTag } from '../DiscordHandler';
import { MemberHandlerTag } from '../MemberHandler';

import type { ClanMember } from 'clashofclans.js';

type ClanMemberTag = Pick<ClanMember, 'name' | 'tag'>;

export const createClanMemberListener = () =>
  Effect.gen(function* () {
    const { events } = yield* ClashTag;
    const sessionStore = yield* SessionStoreTag;
    const memberHandler = yield* MemberHandlerTag;
    const accountDatabase = yield* AccountDatabaseTag;
    const userDatabase = yield* UserDatabaseTag;
    const scope = yield* Effect.scope;

    const clanStores = new Map<string, StoreClient<ClanData>>();
    const leavingQueue = yield* Queue.unbounded<ClanMemberTag>();
    const updateSemaphore = yield* Effect.makeSemaphore(1);

    const handleMemberLeave = (
      player: ClanMemberTag,
    ): Effect.Effect<
      void,
      unknown,
      SessionStoreTag | AccountDatabaseTag | UserDatabaseTag | MemberHandlerTag | DiscordHandlerTag | ConfigStoreTag | ClashTag | SqliteClientTag
    > =>
      Effect.gen(function* () {
        const session = yield* sessionStore.get;
        const leavers = session.leavers ?? [];
        if (!leavers.includes(player.tag)) return;

        const accountOpt = yield* accountDatabase.findOne({ tag: player.tag });

        if (Option.isNone(accountOpt) || !accountOpt.value.userId) {
          yield* sessionStore.update((s) => ({
            ...s,
            leavers: (s.leavers ?? []).filter((t) => t !== player.tag),
          }));
          return;
        }

        const account = accountOpt.value;
        const userOpt = yield* userDatabase.findOne({ id: account.userId });
        if (Option.isNone(userOpt)) {
          yield* sessionStore.update((s) => ({
            ...s,
            leavers: (s.leavers ?? []).filter((t) => t !== player.tag),
          }));
          return;
        }

        const user = userOpt.value;
        const userAccounts = yield* accountDatabase.find({ userId: user.id });
        const otherAccountInClan = yield* memberHandler.findActiveAccount(user.id, player.tag);
        const memberOpt = yield* getGuildMember(user.ownerId);

        if (Option.isSome(memberOpt)) {
          yield* memberHandler.updatePresence(memberOpt.value, otherAccountInClan);
          const tagsToRemove = new Set(userAccounts.map((acc) => acc.tag));
          yield* sessionStore.update((s) => ({
            ...s,
            leavers: (s.leavers ?? []).filter((t) => !tagsToRemove.has(t)),
          }));
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

          const clanStore = clanStores.get(oldClan.tag);
          const currentStore =
            clanStore ??
            (yield* makeStoreClient(`sessions/clan/${oldClan.tag}.json`, ClanSchema, oldClan, 60_000).pipe(
              Effect.provideService(Scope.Scope, scope),
              Effect.tap((s) => Effect.sync(() => clanStores.set(oldClan.tag, s))),
            ));

          const storedClan = yield* currentStore.get;
          const newMemberTags = new Set(newClan.members.map((m) => m.tag));
          const leftMembers = storedClan.members.filter((m) => !newMemberTags.has(m.tag));

          if (leftMembers.length > 0) {
            const session = yield* sessionStore.get;
            const currentPending = new Set(session.leavers ?? []);
            const toAdd: string[] = [];

            for (const player of leftMembers) {
              if (!currentPending.has(player.tag)) {
                toAdd.push(player.tag);
                yield* Queue.offer(leavingQueue, player);
              }
            }

            if (toAdd.length > 0) {
              yield* sessionStore.update((s) => ({
                ...s,
                leavers: [...(s.leavers ?? []), ...toAdd],
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
