import { MemberRoles, ModeratorRoles, RegisterRoles } from '../core/constants';

import type { Role } from 'discord.js';

export const isModeratorRole = (role: Role) => (Object.values(ModeratorRoles) as string[]).includes(role.name);

export const isRegisterRole = (role: Role) => (Object.values(RegisterRoles) as string[]).includes(role.name);

export const isMemberRole = (role: Role) => (Object.values(MemberRoles) as string[]).includes(role.name);

export const isClanRole = (role: Role, clans: readonly { readonly name: string; readonly tag: string }[]) =>
  clans.some((clan) => role.name === clan.name);
