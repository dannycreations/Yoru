export const ClientEvents = {
  ApiError: 'ApiError',
  ClanMember: 'ClanMember',
} as const;

export const ModeratorRoles = {
  Manager: 'Manager',
} as const;

export const RegisterRoles = {
  Entry: 'Entry',
  Pending: 'Pending',
  Reapply: 'Reapply',
  Approved: 'Approved',
} as const;

export const MemberRoles = {
  Leader: 'Leader',
  CoLeader: 'Co-Leader',
  Elder: 'Elder',
  Member: 'Member',
} as const;
