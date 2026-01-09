import { MemberRoles } from '../core/constants';
import { emoji } from '../core/emojis';

import type { ValueOf } from '@vegapunk/utilities';
import type { Player } from 'clashofclans.js';
import type { EmbedFooterOptions } from 'discord.js';

export function parseClan(player: Player): EmbedFooterOptions {
  if (player.clan) {
    const role = parseClanRole(player.role);
    const text = `${role} of ${player.clan.name}\n(${player.clan.tag})`;
    const iconURL = player.clan.badge.url;
    return { text, iconURL };
  }

  const text = 'Player is clanless';
  const iconURL = emoji.thumbnail.replace('{0}', 'badges/noclan.png');
  return { text, iconURL };
}

export function parseClanRole(role: Player['role']): ValueOf<typeof MemberRoles> {
  switch (role) {
    case 'leader':
      return MemberRoles.Leader;
    case 'coLeader':
      return MemberRoles.CoLeader;
    case 'elder':
      return MemberRoles.Elder;
    default:
      return MemberRoles.Member;
  }
}
