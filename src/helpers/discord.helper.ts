import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { Effect, Option } from 'effect';

import { DiscordHandlerTag } from '../workflows/DiscordHandler';

import type { Guild, GuildMember } from 'discord.js';

export const parseMentionOrSnowflake = (input?: string | null): string | null => {
  if (!input) return null;
  return input.match(UserOrMemberMentionRegex)?.[1] || (SnowflakeRegex.test(input) ? input : null);
};

export const getGuild = (userId: string) =>
  Effect.gen(function* () {
    const { client } = yield* DiscordHandlerTag;
    const cache = client.guilds.cache.find((guild) => guild.members.cache.has(userId));
    if (cache) return Option.some(cache);

    // Parallelizing member lookups across all cached guilds ensures that the correct guild context is identified quickly when the member is not present in the local cache.
    const results = yield* Effect.all(
      Array.from(client.guilds.cache.values()).map((guild) =>
        Effect.tryPromise(() => guild.members.fetch(userId)).pipe(
          Effect.map(() => Option.some(guild)),
          Effect.catchAll(() => Effect.succeed(Option.none<Guild>())),
        ),
      ),
      { concurrency: 'unbounded' },
    );

    return Option.fromNullable(results.find(Option.isSome)?.value);
  });

export const getGuildMember = (userId: string) =>
  Effect.gen(function* () {
    const guildOpt = yield* getGuild(userId);
    if (Option.isNone(guildOpt)) return Option.none<GuildMember>();
    const member = yield* Effect.tryPromise(() => guildOpt.value.members.fetch(userId)).pipe(Effect.option);
    return member;
  });
