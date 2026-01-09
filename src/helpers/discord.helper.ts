import { Effect, Option } from 'effect';

import { DiscordClientTag } from '../workflows/DiscordService';

import type { Guild, GuildMember } from 'discord.js';

export const getGuild = (userId: string) =>
  Effect.gen(function* (_) {
    const { client } = yield* _(DiscordClientTag);
    const cache = client.guilds.cache.find((guild) => guild.members.cache.has(userId));
    if (cache) return Option.some(cache);

    for (const guild of client.guilds.cache.values()) {
      const member = yield* _(Effect.tryPromise(() => guild.members.fetch(userId)).pipe(Effect.option));
      if (Option.isSome(member)) return Option.some(guild);
    }
    return Option.none<Guild>();
  });

export const getGuildMember = (userId: string) =>
  Effect.gen(function* (_) {
    const guildOpt = yield* _(getGuild(userId));
    if (Option.isNone(guildOpt)) return Option.none<GuildMember>();
    const member = yield* _(Effect.tryPromise(() => guildOpt.value.members.fetch(userId)).pipe(Effect.option));
    return member;
  });
