import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { Effect, Option } from 'effect';

import { DiscordHandlerTag } from '../workflows/DiscordHandler.js';

import type { Guild, GuildMember, Message, MessagePayload, MessageReplyOptions, Role } from 'discord.js';

export const replyMessage = (message: Message<true>, content: string | MessagePayload | MessageReplyOptions) =>
  Effect.tryPromise(() => message.reply(content)).pipe(Effect.asVoid);

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
      fields.push({
        name: count === 0 ? name : `${name} (cont.)`,
        value: currentValue,
      });

      currentValue = item;
      count++;
      continue;
    }

    currentValue = currentValue ? `${currentValue}${separator}${item}` : item;
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
    const guilds = guild ? [guild] : [...(yield* DiscordHandlerTag).client.guilds.cache.values()];

    for (const g of guilds) {
      const cached = g.members.cache.get(userId);
      if (cached) {
        return Option.some(cached);
      }
    }

    return yield* Effect.firstSuccessOf(guilds.map((g) => Effect.tryPromise(() => g.members.fetch(userId)).pipe(Effect.option)));
  });
