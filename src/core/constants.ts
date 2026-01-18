import { Data } from 'effect';

export const ClientEvents = Data.struct({
  ApiError: 'ApiError',
  ClanMember: 'ClanMember',
} as const);

export type ClientEvents = typeof ClientEvents;

export const ModeratorRoles = Data.struct({
  Manager: 'Manager',
} as const);

export type ModeratorRoles = typeof ModeratorRoles;

export const RegisterRoles = Data.struct({
  Entry: 'Entry',
  Pending: 'Pending',
  Reapply: 'Reapply',
  Approved: 'Approved',
} as const);

export type RegisterRoles = typeof RegisterRoles;

export const MemberRoles = Data.struct({
  Leader: 'Leader',
  CoLeader: 'Co-Leader',
  Elder: 'Elder',
  Member: 'Member',
} as const);

export type MemberRoles = typeof MemberRoles;
