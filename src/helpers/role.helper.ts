import { MemberRoles, ModeratorRoles, RegisterRoles } from '../core/constants';

import type { Role } from 'discord.js';

/**
 * Checks if a given Discord role matches any of the defined Moderator roles.
 */
export const isModeratorRole = (role: Role) => (Object.values(ModeratorRoles) as string[]).includes(role.name);

/**
 * Checks if a given Discord role matches any of the defined Registration roles.
 */
export const isRegisterRole = (role: Role) => (Object.values(RegisterRoles) as string[]).includes(role.name);

/**
 * Checks if a given Discord role matches any of the defined Member roles.
 */
export const isMemberRole = (role: Role) => (Object.values(MemberRoles) as string[]).includes(role.name);

/**
 * Checks if a given Discord role matches any registered clan name.
 */
export const isClanRole = (role: Role, clans: readonly { readonly name: string; readonly tag: string }[]) =>
  clans.some((clan) => role.name === clan.name);
