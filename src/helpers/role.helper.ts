import { MemberRoles, ModeratorRoles, RegisterRoles } from '../core/constants';

import type { Role } from 'discord.js';

// Pre-calculated sets avoid repeated Object.values calls and provide O(1) lookup performance.
const MODERATOR_ROLE_NAMES = new Set<string>(Object.values(ModeratorRoles));
const REGISTER_ROLE_NAMES = new Set<string>(Object.values(RegisterRoles));
const MEMBER_ROLE_NAMES = new Set<string>(Object.values(MemberRoles));

export const isModeratorRole = (role: Role) => MODERATOR_ROLE_NAMES.has(role.name);
export const isRegisterRole = (role: Role) => REGISTER_ROLE_NAMES.has(role.name);
export const isMemberRole = (role: Role) => MEMBER_ROLE_NAMES.has(role.name);
export const isClanRole = (role: Role, clans: readonly { readonly name: string; readonly tag: string }[]) =>
  clans.some((clan) => role.name === clan.name);
