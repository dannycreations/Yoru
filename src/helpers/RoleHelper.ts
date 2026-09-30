import { MemberRoles, ModeratorRoles, RegisterRoles } from '../core/constants.js';

import type { Role } from 'discord.js';

const MODERATOR_ROLE_NAMES: ReadonlySet<string> = new Set<string>(Object.values(ModeratorRoles));
const REGISTER_ROLE_NAMES: ReadonlySet<string> = new Set<string>(Object.values(RegisterRoles));
const MEMBER_ROLE_NAMES: ReadonlySet<string> = new Set<string>(Object.values(MemberRoles));

export const isModeratorRole = (role: Role): boolean => MODERATOR_ROLE_NAMES.has(role.name);
export const isRegisterRole = (role: Role): boolean => REGISTER_ROLE_NAMES.has(role.name);
export const isMemberRole = (role: Role): boolean => MEMBER_ROLE_NAMES.has(role.name);
