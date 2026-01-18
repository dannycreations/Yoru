import { EmbedBuilder } from 'discord.js';

import { MemberRoles } from '../core/constants';
import { emoji } from '../core/emojis';

import type { ValueOf } from '@vegapunk/utilities';
import type { Player } from 'clashofclans.js';
import type { EmbedFooterOptions, GuildMember } from 'discord.js';

const CLAN_ROLE_MAP: Readonly<Record<string, ValueOf<typeof MemberRoles>>> = {
  leader: MemberRoles.Leader,
  coLeader: MemberRoles.CoLeader,
  elder: MemberRoles.Elder,
} as const;

const getThumbnailUrl = (name: string): string => emoji.thumbnail.replace('{0}', name);

export const getPlayerNickname = (member: GuildMember, player: { readonly name: string; readonly tag: string }): string => {
  const isSameName = member.user.username.toLowerCase() === player.name.toLowerCase();
  return isSameName ? `${player.name} ${player.tag}` : player.name;
};

export const parseClan = (player: Player): EmbedFooterOptions => {
  if (player.clan) {
    const role = (player.role && CLAN_ROLE_MAP[player.role]) ?? MemberRoles.Member;
    const text = `${role} of ${player.clan.name}\n(${player.clan.tag})`;
    const iconURL = player.clan.badge.url;
    return { text, iconURL };
  }

  return {
    text: 'Player is clanless',
    iconURL: getThumbnailUrl('badges/noclan.png'),
  };
};

export const formatPlayerStats = (player: Player): string => {
  const level = `${emoji.level} ${player.expLevel}`;
  const trophies = `${emoji.trophies} ${player.trophies.toLocaleString()}`;
  const attacks = `${emoji.attackwin} ${player.attackWins.toLocaleString()}`;
  return `${level} ${trophies} ${attacks}`;
};

export const formatPlayerField = (player: Player): string => {
  const stats = formatPlayerStats(player);
  const clanInfo = player.clan ? `${emoji.isclan.true} ${player.clan.name}` : `${emoji.isclan.false} Player is clanless`;
  return `${emoji.hashtag} ${player.tag}\n${stats}\n${clanInfo}`;
};

export const createPlayerEmbed = (player: Player): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('Open in Clash of Clans ↗')
    .setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${player.tag.replace('#', '')}`);

  const thumbLeague = player.leagueTier ? player.leagueTier.icon.medium : getThumbnailUrl('badges/noleague.png');
  embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague });
  embed.setThumbnail(getThumbnailUrl(`townhalls/townhall-${player.townHallLevel}.png`));

  embed.setFooter(parseClan(player));

  return embed;
};

const UNIT_LOOKUP = (() => {
  const lookup = new Map<string, { readonly category: string; readonly emoji: string }>();
  const add = (data: Readonly<Record<string, string>>, category: string) => {
    for (const [name, emojiValue] of Object.entries(data)) {
      lookup.set(name, { category, emoji: emojiValue });
    }
  };

  add(emoji.troops.normal, 'Troops');
  add(emoji.troops.dark, 'Dark Troops');
  add(emoji.troops.super, 'Super Troops');
  add(emoji.troops.siege, 'Siege Machines');
  add(emoji.troops.pets, 'Pets');
  add(emoji.spells.normal, 'Spells');
  add(emoji.spells.dark, 'Dark Spells');
  add(emoji.heroes, 'Heroes');

  return lookup;
})();

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

  const units = [...player.troops, ...player.spells, ...player.heroes];

  for (const unit of units) {
    if (unit.village !== 'home') {
      continue;
    }

    const mapping = UNIT_LOOKUP.get(unit.name);
    if (mapping) {
      categories[mapping.category].push(`${mapping.emoji}**${unit.level}**/${unit.maxLevel}`);
    } else {
      unknowns.push(unit);
    }
  }

  return { categories, unknowns } as const;
};
