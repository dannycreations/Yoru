import { isErrorLike } from '@vegapunk/utilities/result';
import { Context, Effect, Layer } from 'effect';

import { MemberRoles, RegisterRoles } from '../core/constants';
import { ConfigStoreTag, SessionStoreTag } from '../core/schemas';
import { AccountDatabaseTag } from '../database';
import { getPlayerNickname } from '../helpers/ClashHelper';
import { removeMemberRoles } from '../helpers/DiscordHelper';
import { isClanRole, isMemberRole, isModeratorRole, isRegisterRole } from '../helpers/RoleHelper';
import { ClashTag } from '../services/ClashService';
import { SqliteClientTag } from '../structures/database';

import type { Player } from 'clashofclans.js';
import type { GuildMember } from 'discord.js';
import type { AccountTable } from '../database/schema';

export interface MemberHandler {
  readonly updatePresence: (member: GuildMember, player: Player | null) => Effect.Effect<void, never, typeof SessionStoreTag | typeof ConfigStoreTag>;
  readonly findActiveAccount: (
    userId: number,
    currentTag: string,
  ) => Effect.Effect<Player | null, never, SqliteClientTag | typeof ClashTag | typeof ConfigStoreTag | typeof AccountDatabaseTag>;
  readonly getPlayer: (
    account: AccountTable,
  ) => Effect.Effect<{ player: Player | null; banned: boolean; tag: string }, never, typeof ClashTag | SqliteClientTag | typeof AccountDatabaseTag>;
}

export class MemberHandlerTag extends Context.Tag('@workflows/MemberHandler')<MemberHandlerTag, MemberHandler>() {}

export const MemberHandlerLayer = Layer.effect(
  MemberHandlerTag,
  Effect.gen(function* () {
    const clash = yield* ClashTag;
    const configStore = yield* ConfigStoreTag;
    const sessionStore = yield* SessionStoreTag;
    const accountDatabase = yield* AccountDatabaseTag;

    const getPlayer = (account: AccountTable) =>
      Effect.gen(function* () {
        return yield* clash.getPlayer(account.tag).pipe(
          Effect.map((player) => ({ player, banned: false as const, tag: account.tag })),
          Effect.catchIf(
            (error) => isErrorLike<{ reason: string }>(error) && error.reason === 'notFound',
            () =>
              accountDatabase.update({ ...account, bannedAt: Date.now() }).pipe(Effect.as({ player: null, banned: true as const, tag: account.tag })),
          ),
          Effect.catchAll(() => Effect.succeed({ player: null, banned: false as const, tag: account.tag })),
        );
      });

    const findActiveAccount = (userId: number, currentTag: string) =>
      Effect.gen(function* () {
        const config = yield* configStore.get;
        const userAccounts = yield* accountDatabase.find({ userId });
        const otherAccounts = userAccounts.filter((acc) => !acc.bannedAt && acc.tag !== currentTag);

        const results = yield* Effect.all(
          otherAccounts.map((account) =>
            getPlayer(account).pipe(Effect.map(({ player: p }) => (p && p.clan && config.clanTags.includes(p.clan.tag) ? p : null))),
          ),
          { concurrency: 'unbounded' },
        );

        return results.find((p) => p !== null) ?? null;
      }).pipe(Effect.catchAllCause(() => Effect.succeed(null)));

    const updatePresence = (member: GuildMember, player: Player | null) =>
      Effect.gen(function* () {
        if (member.roles.cache.some(isModeratorRole)) return;

        const guild = member.guild;
        const config = yield* configStore.get;
        const session = yield* sessionStore.get;

        if (player && player.clan && config.clanTags.includes(player.clan.tag)) {
          const nickname = getPlayerNickname(member, player);
          yield* Effect.tryPromise(() => member.setNickname(nickname));

          yield* removeMemberRoles(member, isRegisterRole);

          const clanName = player.clan.name;
          const rolesToAdd = guild.roles.cache.filter((r) => r.name === clanName || r.name === MemberRoles.Elder);
          if (rolesToAdd.size > 0) yield* Effect.tryPromise(() => member.roles.add(rolesToAdd));
        } else if (player) {
          yield* Effect.tryPromise(() => member.setNickname(`TH ${player.townHallLevel} - ${player.name}`));

          yield* removeMemberRoles(member, isRegisterRole);

          const approvedRole = guild.roles.cache.find((r) => r.name === RegisterRoles.Approved);
          if (approvedRole) yield* Effect.tryPromise(() => member.roles.add(approvedRole));
        } else {
          yield* removeMemberRoles(member, (r) => isMemberRole(r) || isClanRole(r, session.clans ?? []));

          const reapplyRole = guild.roles.cache.find((r) => r.name === RegisterRoles.Reapply);
          if (reapplyRole) yield* Effect.tryPromise(() => member.roles.add(reapplyRole));
        }
      }).pipe(Effect.catchAll((error) => Effect.logError(`Failed to update Discord presence for ${member.id}`, error)));

    return {
      findActiveAccount,
      updatePresence,
      getPlayer,
    };
  }),
);
