import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { Array, Effect, Option } from 'effect';

import { DiscordHandlerTag } from '../workflows/DiscordHandler';

import type { Guild, GuildMember, Role } from 'discord.js';

export const getSplitFields = (
  name: string,
  list: readonly string[],
  separator = ' ',
): ReadonlyArray<{ readonly name: string; readonly value: string }> => {
  const { fields, currentValue, count } = Array.reduce(
    list,
    { fields: [] as Array<{ readonly name: string; readonly value: string }>, currentValue: '', count: 0 },
    (acc, item) => {
      const isOverLimit = acc.currentValue.length + item.length + separator.length > 1024;
      if (isOverLimit && acc.currentValue) {
        return {
          fields: [...acc.fields, { name: acc.count === 0 ? name : `${name} (cont.)`, value: acc.currentValue }],
          currentValue: item,
          count: acc.count + 1,
        };
      }
      return {
        ...acc,
        currentValue: acc.currentValue ? `${acc.currentValue}${separator}${item}` : item,
      };
    },
  );

  return currentValue ? [...fields, { name: count === 0 ? name : `${name} (cont.)`, value: currentValue }] : fields;
};

export const removeMemberRoles = (member: GuildMember, filter: (role: Role) => boolean): Effect.Effect<void, Error> =>
  Effect.suspend(() => {
    const roles = member.roles.cache.filter(filter);
    return roles.size > 0 ? Effect.tryPromise(() => member.roles.remove(roles)).pipe(Effect.asVoid) : Effect.void;
  });

export const parseMentionOrSnowflake = (input?: string | null): string | null => {
  if (!input) return null;
  return input.match(UserOrMemberMentionRegex)?.[1] || (SnowflakeRegex.test(input) ? input : null);
};

export const getGuildMember = (userId: string, guild?: Guild) =>
  Effect.gen(function* () {
    if (guild) {
      const cached = guild.members.cache.get(userId);
      if (cached) {
        return Option.some(cached);
      }
      return yield* Effect.tryPromise(() => guild.members.fetch(userId)).pipe(Effect.option);
    }

    const { client } = yield* DiscordHandlerTag;

    const guilds = Array.fromIterable(client.guilds.cache.values());

    const cachedMember = Array.findFirst(guilds, (g) => g.members.cache.has(userId)).pipe(Option.map((g) => g.members.cache.get(userId)!));

    if (Option.isSome(cachedMember)) {
      return cachedMember;
    }

    const results = yield* Effect.all(
      Array.map(guilds, (g) =>
        Effect.tryPromise(() => g.members.fetch(userId)).pipe(
          Effect.option,
          Effect.catchAll(() => Effect.succeed(Option.none<GuildMember>())),
        ),
      ),
      { concurrency: 'inherit' },
    );

    return Array.findFirst(results, (opt) => Option.isSome(opt)).pipe(Option.flatten);
  });
