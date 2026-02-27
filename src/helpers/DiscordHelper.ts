import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { Effect, Option } from 'effect';

import { DiscordHandlerTag } from '../workflows/DiscordHandler';

import type { Guild, GuildMember, Role } from 'discord.js';

export const getSplitFields = (
  name: string,
  list: readonly string[],
  separator = ' ',
): ReadonlyArray<{ readonly name: string; readonly value: string }> => {
  const fields: { name: string; value: string }[] = [];
  let currentValue = '';
  let count = 0;

  for (const item of list) {
    if (currentValue && currentValue.length + item.length + separator.length > 1024) {
      fields.push({ name: count === 0 ? name : `${name} (cont.)`, value: currentValue });
      currentValue = item;
      count++;
    } else {
      currentValue = currentValue ? `${currentValue}${separator}${item}` : item;
    }
  }

  if (currentValue) {
    fields.push({ name: count === 0 ? name : `${name} (cont.)`, value: currentValue });
  }

  return fields;
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
      if (cached) return Option.some(cached);
      return yield* Effect.tryPromise(() => guild.members.fetch(userId)).pipe(Effect.option);
    }

    const { client } = yield* DiscordHandlerTag;

    for (const g of client.guilds.cache.values()) {
      const cached = g.members.cache.get(userId);
      if (cached) return Option.some(cached);
    }

    const guilds = [...client.guilds.cache.values()];
    const fetchMember = (g: Guild) =>
      Effect.tryPromise(() => g.members.fetch(userId)).pipe(
        Effect.option,
        Effect.catchAll(() => Effect.succeed(Option.none<GuildMember>())),
      );

    return yield* Effect.firstSuccessOf(guilds.map(fetchMember)).pipe(Effect.catchAll(() => Effect.succeed(Option.none<GuildMember>())));
  });
