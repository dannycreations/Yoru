import { isErrorLike } from '@vegapunk/utilities/result';
import { Context, Effect, Layer, Option } from 'effect';

import { MemberRoles, RegisterRoles } from '../core/constants';
import { ConfigStoreTag, SessionStoreTag } from '../core/schemas';
import { AccountDatabaseTag } from '../database';
import { getPlayerNickname } from '../helpers/ClashHelper';
import { removeMemberRoles } from '../helpers/DiscordHelper';
import { isClanRole, isMemberRole, isModeratorRole, isRegisterRole } from '../helpers/RoleHelper';
import { ClashClientTag } from '../services/ClashService';
import { SqliteClientTag } from '../structures/database';

import type { Player } from 'clashofclans.js';
import type { GuildMember } from 'discord.js';
import type { AccountTable } from '../database/schema';

export interface MemberHandler {
  readonly updatePresence: (member: GuildMember, player: Option.Option<Player>) => Effect.Effect<void, never, SessionStoreTag | ConfigStoreTag>;
  readonly findActiveAccount: (
    userId: number,
    currentTag: string,
  ) => Effect.Effect<Option.Option<Player>, never, SqliteClientTag | ClashClientTag | ConfigStoreTag | AccountDatabaseTag>;
  readonly getPlayer: (
    account: AccountTable,
  ) => Effect.Effect<
    { readonly player: Option.Option<Player>; readonly banned: boolean; readonly tag: string },
    never,
    ClashClientTag | SqliteClientTag | AccountDatabaseTag
  >;
}

export class MemberHandlerTag extends Context.Tag('@workflows/MemberHandler')<MemberHandlerTag, MemberHandler>() {}

export const MemberHandlerLayer = Layer.effect(
  MemberHandlerTag,
  Effect.gen(function* () {
    const clash = yield* ClashClientTag;
    const configStore = yield* ConfigStoreTag;
    const sessionStore = yield* SessionStoreTag;
    const accountDatabase = yield* AccountDatabaseTag;

    const getPlayer = (account: AccountTable) =>
      clash.getPlayer(account.tag).pipe(
        Effect.map((player) => ({ player: Option.some(player), banned: false as const, tag: account.tag })),
        Effect.catchIf(
          (error) => isErrorLike<{ reason: string }>(error) && error.reason === 'notFound',
          () =>
            accountDatabase
              .update({ ...account, bannedAt: Date.now() })
              .pipe(Effect.as({ player: Option.none(), banned: true as const, tag: account.tag })),
        ),
        Effect.orElseSucceed(() => ({ player: Option.none(), banned: false as const, tag: account.tag })),
      );

    const findActiveAccount = (userId: number, currentTag: string) =>
      Effect.gen(function* () {
        const userAccounts = yield* accountDatabase.find({ userId });
        const otherAccounts = userAccounts.filter((acc) => !acc.bannedAt && acc.tag !== currentTag);

        if (otherAccounts.length === 0) {
          return Option.none();
        }

        const clanCache = yield* clash.getClans();
        for (const account of otherAccounts) {
          for (const clan of clanCache.values()) {
            const member = clan.members.find((m) => m.tag === account.tag);
            if (member) {
              const player = yield* clash.getPlayer(account.tag);
              return Option.some(player);
            }
          }
        }

        return Option.none();
      }).pipe(Effect.catchAllCause(() => Effect.succeed(Option.none())));

    const updatePresence = (member: GuildMember, playerOpt: Option.Option<Player>) =>
      Effect.gen(function* () {
        if (member.roles.cache.some(isModeratorRole)) {
          return;
        }

        const guild = member.guild;
        const config = yield* configStore.get;
        const session = yield* sessionStore.get;

        if (Option.isNone(playerOpt)) {
          yield* removeMemberRoles(member, (r) => isMemberRole(r) || isClanRole(r, session.clans ?? []));

          const reapplyRole = guild.roles.cache.find((r) => r.name === RegisterRoles.Reapply);
          if (reapplyRole) {
            yield* Effect.tryPromise(() => member.roles.add(reapplyRole));
          }

          return;
        }

        const player = playerOpt.value;

        if (!player.clan || !config.clanTags.includes(player.clan.tag)) {
          yield* Effect.tryPromise(() => member.setNickname(`TH ${player.townHallLevel} - ${player.name}`));
          yield* removeMemberRoles(member, isRegisterRole);

          const approvedRole = guild.roles.cache.find((r) => r.name === RegisterRoles.Approved);
          if (approvedRole) {
            yield* Effect.tryPromise(() => member.roles.add(approvedRole));
          }

          return;
        }

        const nickname = getPlayerNickname(member, player);
        yield* Effect.tryPromise(() => member.setNickname(nickname));
        yield* removeMemberRoles(member, isRegisterRole);

        const clanName = player.clan.name;
        const rolesToAdd = guild.roles.cache.filter((r) => r.name === clanName || r.name === MemberRoles.Elder);
        if (rolesToAdd.size > 0) {
          yield* Effect.tryPromise(() => member.roles.add(rolesToAdd));
        }
      }).pipe(Effect.catchAll((error) => Effect.logError(`Failed to update Discord presence for ${member.id}`, error)));

    return {
      findActiveAccount,
      updatePresence,
      getPlayer,
    };
  }),
);
