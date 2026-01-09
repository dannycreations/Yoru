import { MemberRoles, ModeratorRoles, RegisterRoles } from '../core/constants';

import type { ValueOf } from '@vegapunk/utilities';
import type { Role } from 'discord.js';

export const isModeratorRole = (r: Role): boolean => Object.values(ModeratorRoles).includes(r.name as ValueOf<typeof ModeratorRoles>);

export const isRegisterRole = (r: Role): boolean => Object.values(RegisterRoles).includes(r.name as ValueOf<typeof RegisterRoles>);

export const isMemberRole = (r: Role): boolean => Object.values(MemberRoles).includes(r.name as ValueOf<typeof MemberRoles>);

export const isClanRole = (r: Role, clans: readonly { readonly name: string; readonly tag: string }[]): boolean =>
  clans.some((s) => r.name === s.name);
