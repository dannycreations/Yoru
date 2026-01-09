import { MemberRoles, ModeratorRoles, RegisterRoles } from '../core/constants';

import type { ValueOf } from '@vegapunk/utilities';
import type { Role } from 'discord.js';

export const isModeratorRole = (role: Role) => Object.values(ModeratorRoles).includes(role.name as ValueOf<typeof ModeratorRoles>);

export const isRegisterRole = (role: Role) => Object.values(RegisterRoles).includes(role.name as ValueOf<typeof RegisterRoles>);

export const isMemberRole = (role: Role) => Object.values(MemberRoles).includes(role.name as ValueOf<typeof MemberRoles>);

export const isClanRole = (role: Role, clans: readonly { readonly name: string; readonly tag: string }[]) =>
  clans.some((clan) => role.name === clan.name);
