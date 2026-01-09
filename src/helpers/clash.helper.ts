import { MemberRoles } from '../core/constants';
import { emoji } from '../core/emojis';

import type { Player } from 'clashofclans.js';
import type { EmbedFooterOptions } from 'discord.js';

export const parseClanRole = (role: Player['role']): (typeof MemberRoles)[keyof typeof MemberRoles] => {
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
};

export const parseClan = (player: Player): EmbedFooterOptions => {
  if (player.clan) {
    const role = parseClanRole(player.role);
    const text = `${role} of ${player.clan.name}\n(${player.clan.tag})`;
    const iconURL = player.clan.badge.url;
    return { text, iconURL };
  }

  const text = 'Player is clanless';
  const iconURL = emoji.thumbnail.replace('{0}', 'badges/noclan.png');
  return { text, iconURL };
};

export const formatPlayerStats = (player: Player): string => {
  const level = `${emoji.level} ${player.expLevel}`;
  const trophies = `${emoji.trophies} ${player.trophies.toLocaleString()}`;
  const attacks = `${emoji.attackwin} ${player.attackWins.toLocaleString()}`;
  return `${level} ${trophies} ${attacks}`;
};

export const categorizeUnits = (player: Player) => {
  const categories: Record<string, string[]> = {
    Troops: [],
    'Dark Troops': [],
    'Super Troops': [],
    'Siege Machines': [],
    Pets: [],
    Spells: [],
    'Dark Spells': [],
    Heroes: [],
  };
  const unknowns: unknown[] = [];

  /**
   * Helper to process a list of units (troops, spells, heroes) and categorize them based on emoji data.
   * This reduces code duplication across different unit types.
   */
  const processUnits = (
    units: Array<{ name: string; level: number; maxLevel: number; village: string }>,
    maps: ReadonlyArray<{ data: Record<string, string>; category: string }>,
  ) => {
    units
      .filter((u) => u.village === 'home')
      .forEach((unit) => {
        const field = `**${unit.level}**/${unit.maxLevel}`;
        const found = maps.find((m) => m.data[unit.name]);
        if (found) {
          categories[found.category].push(found.data[unit.name] + field);
        } else {
          unknowns.push(unit);
        }
      });
  };

  processUnits(player.troops, [
    { data: emoji.troops.normal, category: 'Troops' },
    { data: emoji.troops.dark, category: 'Dark Troops' },
    { data: emoji.troops.super, category: 'Super Troops' },
    { data: emoji.troops.siege, category: 'Siege Machines' },
    { data: emoji.troops.pets, category: 'Pets' },
  ]);

  processUnits(player.spells, [
    { data: emoji.spells.normal, category: 'Spells' },
    { data: emoji.spells.dark, category: 'Dark Spells' },
  ]);

  processUnits(player.heroes, [{ data: emoji.heroes, category: 'Heroes' }]);

  return { categories, unknowns };
};
