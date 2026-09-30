import { Array, Effect, Option, PubSub, Queue } from 'effect';

import { SessionStoreTag } from '../../core/schemas.js';
import { AccountDatabaseTag } from '../../database/index.js';
import { userTable } from '../../database/schema.js';
import { getGuildMember } from '../../helpers/DiscordHelper.js';
import { ClashClientTag } from '../../services/ClashService.js';
import { MemberHandlerTag } from '../MemberHandler.js';

import type { ClanMember } from 'clashofclans.js';
import type { ClanData } from '../../services/ClashService.js';

type ClanMemberTag = Pick<ClanMember, 'name' | 'tag'>;

export const createClanMemberListener = () =>
  Effect.gen(function* () {
    const { events } = yield* ClashClientTag;
    const sessionStore = yield* SessionStoreTag;
    const memberHandler = yield* MemberHandlerTag;
    const accountDatabase = yield* AccountDatabaseTag;

    const leavingQueue = yield* Queue.unbounded<ClanMemberTag>();

    const handleMemberLeave = (player: ClanMemberTag) =>
      Effect.gen(function* () {
        const session = yield* sessionStore.get;
        const leavers = session.leavers ?? [];
        if (!leavers.includes(player.tag)) {
          return;
        }

        const cleanupLeaver = (tags: ReadonlyArray<string>) => {
          const tagSet = new Set(tags);
          return sessionStore.update((s) => ({
            ...s,
            leavers: (s.leavers ?? []).filter((t) => !tagSet.has(t)),
          }));
        };

        const rowOpt = yield* accountDatabase.findOne(
          { tag: player.tag },
          { joins: [{ table: userTable, on: { userId: 'id' }, type: 'inner' }], select: { userId: 1, ownerId: 1 } },
        );

        if (Option.isNone(rowOpt)) {
          yield* cleanupLeaver([player.tag]);
          return;
        }

        const { userId, ownerId } = rowOpt.value;
        const userAccounts = yield* accountDatabase.find({ userId });
        const otherAccountInClan = yield* memberHandler.findActiveAccount(userAccounts, player.tag);
        const memberOpt = yield* getGuildMember(ownerId);

        if (Option.isNone(memberOpt)) {
          return;
        }

        yield* memberHandler.updatePresence(memberOpt.value, otherAccountInClan);
        yield* cleanupLeaver(Array.map(userAccounts, (acc) => acc.tag));
      });

    yield* Effect.forever(
      Queue.take(leavingQueue).pipe(
        Effect.flatMap((player) =>
          handleMemberLeave(player).pipe(Effect.catchAllCause((cause) => Effect.logError(`Error processing leaving member ${player.tag}`, cause))),
        ),
      ),
    ).pipe(Effect.forkScoped);

    // Events are handled one at a time, so a clan snapshot and the leaver list stay in step.
    const onClanMemberUpdate = (oldClan: ClanData, newClan: ClanData) =>
      Effect.gen(function* () {
        const session = yield* sessionStore.get;
        const clans = session.clans ?? [];
        if (!Array.some(clans, (r) => r.tag === oldClan.tag)) {
          yield* sessionStore.update((s) => ({
            ...s,
            clans: Array.append(s.clans ?? [], { name: oldClan.name, tag: oldClan.tag }),
          }));
        }

        const newMemberTags = new Set(newClan.members.map((m) => m.tag));
        const leftMembers = oldClan.members.filter((m: ClanMemberTag) => !newMemberTags.has(m.tag));

        if (leftMembers.length === 0) {
          return;
        }

        const pending = new Set(session.leavers ?? []);
        const toAdd = leftMembers.filter((m) => !pending.has(m.tag));

        if (toAdd.length === 0) {
          return;
        }

        yield* Queue.offerAll(leavingQueue, toAdd);

        yield* sessionStore.update((s) => ({
          ...s,
          leavers: [...(s.leavers ?? []), ...toAdd.map((m) => m.tag)],
        }));
      });

    yield* PubSub.subscribe(events).pipe(
      Effect.flatMap((queue) =>
        Effect.forever(
          Effect.gen(function* () {
            const events = yield* Queue.takeAll(queue);
            yield* Effect.forEach(
              events,
              (event) =>
                onClanMemberUpdate(event.oldClan, event.newClan).pipe(
                  Effect.catchAllCause((cause) => Effect.logError('Error in ClanMemberUpdate handler', cause)),
                ),
              { concurrency: 'inherit' },
            );
          }),
        ),
      ),
      Effect.forkScoped,
    );
  });
