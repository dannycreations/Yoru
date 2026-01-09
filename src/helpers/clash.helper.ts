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

  const troopMap = [
    { data: emoji.troops.normal, category: 'Troops' },
    { data: emoji.troops.dark, category: 'Dark Troops' },
    { data: emoji.troops.super, category: 'Super Troops' },
    { data: emoji.troops.siege, category: 'Siege Machines' },
    { data: emoji.troops.pets, category: 'Pets' },
  ] as const;

  player.troops
    .filter((r) => r.village === 'home')
    .forEach((troop) => {
      const field = `**${troop.level}**/${troop.maxLevel}`;
      const found = troopMap.find((m) => m.data[troop.name]);
      if (found) {
        categories[found.category].push(found.data[troop.name] + field);
      } else {
        unknowns.push(troop);
      }
    });

  const spellMap = [
    { data: emoji.spells.normal, category: 'Spells' },
    { data: emoji.spells.dark, category: 'Dark Spells' },
  ] as const;

  player.spells
    .filter((r) => r.village === 'home')
    .forEach((spell) => {
      const field = `**${spell.level}**/${spell.maxLevel}`;
      const found = spellMap.find((m) => m.data[spell.name]);
      if (found) {
        categories[found.category].push(found.data[spell.name] + field);
      } else {
        unknowns.push(spell);
      }
    });

  player.heroes
    .filter((r) => r.village === 'home')
    .forEach((hero) => {
      if (emoji.heroes[hero.name]) {
        categories['Heroes'].push(emoji.heroes[hero.name] + `**${hero.level}**/${hero.maxLevel}`);
      } else {
        unknowns.push(hero);
      }
    });

  return { categories, unknowns };
};
