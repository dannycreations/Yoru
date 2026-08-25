export const ClientEvents = {
  ClanMember: 'ClanMember',
} as const;

export type ClientEvents = typeof ClientEvents;

export const ModeratorRoles = {
  Manager: 'Manager',
} as const;

export type ModeratorRoles = typeof ModeratorRoles;

export const RegisterRoles = {
  Entry: 'Entry',
  Pending: 'Pending',
  Reapply: 'Reapply',
  Approved: 'Approved',
} as const;

export type RegisterRoles = typeof RegisterRoles;

export const MemberRoles = {
  Leader: 'Leader',
  CoLeader: 'Co-Leader',
  Elder: 'Elder',
  Member: 'Member',
} as const;

export type MemberRoles = typeof MemberRoles;
