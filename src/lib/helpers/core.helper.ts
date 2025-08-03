import { container } from '@sapphire/framework';
import { attemptAsync } from '@vegapunk/utilities/common';
import { GuildMember, Role } from 'discord.js';

import { MemberRoles, ModeratorRoles, RegisterRoles } from '../contants/enum';

export const isModeratorRole = (r: Role): boolean => !!(ModeratorRoles as StringObject)[r.name];
export const isRegisterRole = (r: Role): boolean => !!(RegisterRoles as StringObject)[r.name];
export const isMemberRole = (r: Role): boolean => !!(MemberRoles as StringObject)[r.name];
export const isClanRole = (r: Role): boolean => container.client.sessions.data.clans.some((s) => r.name === s.name);

export function getGuild(userId: string) {
  return container.client.guilds.cache.find((guild) => guild.members.cache.has(userId));
}

export async function getGuildMember(userId: string): Promise<[null, GuildMember | null] | [Error, null]> {
  return attemptAsync(async () => {
    const guild = getGuild(userId);
    if (!guild) {
      return null;
    }

    return await guild.members.fetch(userId);
  });
}

type StringObject = Record<string, string>;
