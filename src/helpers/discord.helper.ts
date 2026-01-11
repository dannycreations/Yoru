import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { Effect, Option } from 'effect';

import { DiscordHandlerTag } from '../workflows/DiscordHandler';

import type { Guild, GuildMember } from 'discord.js';

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

    for (const g of client.guilds.cache.values()) {
      const cachedMember = g.members.cache.get(userId);
      if (cachedMember) return Option.some(cachedMember);
    }

    const results = yield* Effect.all(
      Array.from(client.guilds.cache.values()).map((g) =>
        Effect.tryPromise(() => g.members.fetch(userId)).pipe(
          Effect.map(Option.some),
          Effect.catchAll(() => Effect.succeed(Option.none<GuildMember>())),
        ),
      ),
      { concurrency: 'unbounded' },
    );

    return Option.fromNullable(results.find(Option.isSome)?.value);
  });
