import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { Effect, Option } from 'effect';

import { DiscordHandlerTag } from '../workflows/DiscordHandler';

import type { EmbedBuilder, Guild, GuildMember, Role } from 'discord.js';

export const addSplitFields = (embed: EmbedBuilder, name: string, list: string[], separator = ' ') => {
  let value = '';
  let count = 0;
  for (const item of list) {
    if (value.length + item.length + separator.length > 1024) {
      embed.addFields({ name: count === 0 ? name : `${name} (cont.)`, value });
      value = item;
      count++;
    } else {
      value = value ? `${value}${separator}${item}` : item;
    }
  }
  if (value) embed.addFields({ name: count === 0 ? name : `${name} (cont.)`, value });
};

export const removeMemberRoles = (member: GuildMember, filter: (role: Role) => boolean) => {
  const roles = member.roles.cache.filter(filter);
  return roles.size > 0 ? Effect.tryPromise(() => member.roles.remove(roles)) : Effect.void;
};

export const parseMentionOrSnowflake = (input?: string | null): string | null => {
  if (!input) return null;
  return input.match(UserOrMemberMentionRegex)?.[1] || (SnowflakeRegex.test(input) ? input : null);
};

// Retrieving a member directly from a specified guild or searching across all cached guilds ensures that the correct member context is identified with minimal REST API overhead.
export const getGuildMember = (userId: string, guild?: Guild) =>
  Effect.gen(function* () {
    if (guild) {
      const cached = guild.members.cache.get(userId);
      if (cached) return Option.some(cached);
      return yield* Effect.tryPromise(() => guild.members.fetch(userId)).pipe(Effect.option);
    }

    const { client } = yield* DiscordHandlerTag;

    const cachedMember = Array.from(client.guilds.cache.values())
      .find((g) => g.members.cache.has(userId))
      ?.members.cache.get(userId);
    if (cachedMember) return Option.some(cachedMember);

    const results = yield* Effect.all(
      Array.from(client.guilds.cache.values()).map((g) =>
        Effect.tryPromise(() => g.members.fetch(userId)).pipe(
          Effect.map(Option.some),
          Effect.catchAll(() => Effect.succeed(Option.none<GuildMember>())),
        ),
      ),
      { concurrency: 'unbounded' },
    );

    const found = results.find(Option.isSome);
    return found ?? Option.none<GuildMember>();
  });
