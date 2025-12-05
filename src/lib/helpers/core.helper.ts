import { container } from '@sapphire/framework';
import { attemptAsync } from '@vegapunk/utilities/common';

import { MemberRoles, ModeratorRoles, RegisterRoles } from '../core/constants';

import type { Guild, GuildMember, Role } from 'discord.js';

export const isModeratorRole = (r: Role): boolean => !!(ModeratorRoles as StringObject)[r.name];
export const isRegisterRole = (r: Role): boolean => !!(RegisterRoles as StringObject)[r.name];
export const isMemberRole = (r: Role): boolean => !!(MemberRoles as StringObject)[r.name];
export const isClanRole = (r: Role): boolean => container.client.sessions.data.clans.some((s) => r.name === s.name);

export async function getGuild(userId: string): Promise<[null, Guild | null] | [Error, null]> {
  return attemptAsync(async () => {
    const cache = container.client.guilds.cache.find((guild) => {
      return guild.members.cache.has(userId);
    });
    if (cache) {
      return cache;
    }

    for (const guild of container.client.guilds.cache.values()) {
      try {
        await guild.members.fetch(userId);
        return guild;
      } catch {}
    }
    return null;
  });
}

export async function getGuildMember(userId: string): Promise<[null, GuildMember | null] | [Error, null]> {
  return attemptAsync(async () => {
    const [error, guild] = await getGuild(userId);
    if (error || !guild) {
      if (error) {
        container.logger.error(error);
      }
      return null;
    }
    return guild.members.fetch(userId);
  });
}

type StringObject = Record<string, string>;
