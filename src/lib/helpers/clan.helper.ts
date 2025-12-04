import { emoji } from '../contants/emoji';
import { MemberRoles } from '../contants/enum';

import type { Player } from 'clashofclans.js';

export function parseClan(player: Player, callback: (text: string, badge: string) => void): void {
  let text = 'Player is clanless';
  let badge = emoji.thumbnail.replace('{0}', 'badges/noclan.png');

  if (player.clan) {
    // @ts-expect-error
    (player as { role: MemberRoles }).role = parseClanRole(player.role);
    text = `${player.role} of ${player.clan.name}\n(${player.clan.tag})`;
    badge = player.clan.badge.url;
  }

  callback(text, badge);
}

export function parseClanRole(role: Player['role']): MemberRoles {
  if (role === 'leader') {
    return MemberRoles.Leader;
  }
  if (role === 'coLeader') {
    return MemberRoles.CoLeader;
  }
  if (role === 'elder') {
    return MemberRoles.Elder;
  }
  return MemberRoles.Member;
}
