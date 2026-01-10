import { isErrorLike } from '@vegapunk/utilities/result';
import { Context, Effect, Layer } from 'effect';

import { MemberRoles, RegisterRoles } from '../core/constants';
import { ConfigStoreTag, SessionStoreTag } from '../core/schemas';
import { AccountAdapter } from '../database';
import { getPlayerNickname } from '../helpers/clash.helper';
import { isClanRole, isMemberRole, isModeratorRole, isRegisterRole } from '../helpers/role.helper';
import { ClashTag } from '../services/ClashService';
import { SqliteTag } from '../services/database';

import type { Player } from 'clashofclans.js';
import type { GuildMember } from 'discord.js';

export interface MemberManager {
  readonly updatePresence: (member: GuildMember, player: Player | null) => Effect.Effect<void, never, SessionStoreTag | ConfigStoreTag>;
  readonly findActiveAccount: (
    userId: number,
    currentTag: string,
  ) => Effect.Effect<Player | null, never, SqliteTag | typeof ClashTag | ConfigStoreTag>;
}

export const MemberManagerTag = Context.GenericTag<MemberManager>('@domain/MemberManager');

export const MemberManagerLayer = Layer.effect(
  MemberManagerTag,
  Effect.gen(function* () {
    const { client: clash } = yield* ClashTag;
    const configStore = yield* ConfigStoreTag;
    const sessionStore = yield* SessionStoreTag;

    const findActiveAccount = (userId: number, currentTag: string) =>
      Effect.gen(function* () {
        const config = yield* configStore.get;
        const userAccounts = yield* AccountAdapter.find({ userId });
        const otherAccounts = userAccounts.filter((acc) => !acc.bannedAt && acc.tag !== currentTag);

        const results = yield* Effect.all(
          otherAccounts.map((account) =>
            Effect.tryPromise(() => clash.getPlayer(account.tag)).pipe(
              Effect.map((p) => (p.clan && config.clanTags.includes(p.clan.tag) ? p : null)),
              Effect.catchIf(
                (error) => isErrorLike<{ reason: string }>(error) && error.reason === 'notFound',
                () => AccountAdapter.update({ ...account, bannedAt: Date.now() }).pipe(Effect.as(null)),
              ),
              Effect.catchAll(() => Effect.succeed(null)),
            ),
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

        // Encapsulating role removal logic into a local utility reduces duplication and simplifies the conditional branches for presence updates.
        const removeRoles = (filter: (role: any) => boolean) => {
          const roles = member.roles.cache.filter(filter);
          return roles.size > 0 ? Effect.tryPromise(() => member.roles.remove(roles)) : Effect.void;
        };

        if (player && player.clan && config.clanTags.includes(player.clan.tag)) {
          const nickname = getPlayerNickname(member, player);
          yield* Effect.tryPromise(() => member.setNickname(nickname));

          yield* removeRoles(isRegisterRole);

          const clanName = player.clan.name;
          const rolesToAdd = guild.roles.cache.filter((r) => r.name === clanName || r.name === MemberRoles.Elder);
          if (rolesToAdd.size > 0) yield* Effect.tryPromise(() => member.roles.add(rolesToAdd));
        } else if (player) {
          yield* Effect.tryPromise(() => member.setNickname(`TH ${player.townHallLevel} - ${player.name}`));

          yield* removeRoles(isRegisterRole);

          const approvedRole = guild.roles.cache.find((r) => r.name === RegisterRoles.Approved);
          if (approvedRole) yield* Effect.tryPromise(() => member.roles.add(approvedRole));
        } else {
          yield* removeRoles((r) => isMemberRole(r) || isClanRole(r, session.clans));

          const reapplyRole = guild.roles.cache.find((r) => r.name === RegisterRoles.Reapply);
          if (reapplyRole) yield* Effect.tryPromise(() => member.roles.add(reapplyRole));
        }
      }).pipe(Effect.catchAll((error) => Effect.logError(`Failed to update Discord presence for ${member.id}`, error)));

    return {
      findActiveAccount,
      updatePresence,
    };
  }),
);
