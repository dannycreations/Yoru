import { EmbedBuilder } from 'discord.js';

import { MemberRoles } from '../core/constants';
import { emoji } from '../core/emojis';

import type { ValueOf } from '@vegapunk/utilities';
import type { Player } from 'clashofclans.js';
import type { EmbedFooterOptions, GuildMember } from 'discord.js';

const CLAN_ROLE_MAP: Record<string, ValueOf<typeof MemberRoles>> = {
  leader: MemberRoles.Leader,
  coLeader: MemberRoles.CoLeader,
  elder: MemberRoles.Elder,
};

const getThumbnailUrl = (name: string): string => emoji.thumbnail.replace('{0}', name);

// Standardization of nickname generation logic across the system ensures that player identity is represented consistently within Discord.
export const getPlayerNickname = (member: GuildMember, player: { name: string; tag: string }): string => {
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

// Standardized summaries of player status, including tags, basic statistics, and clan affiliations, ensure consistent presentation across commands.
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

  // Pre-configuring the footer with clan information reduces boilerplate in command handlers that display player profiles.
  embed.setFooter(parseClan(player));

  return embed;
};

// A pre-computed mapping of unit names to their respective categories and emojis improves lookup performance during player profile generation.
const UNIT_LOOKUP = (() => {
  const lookup = new Map<string, { category: string; emoji: string }>();
  const add = (data: Record<string, string>, category: string) => {
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

// Unit categorization and formatting with corresponding emojis and levels provide a detailed overview of player progression.
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

  // Categorizing player units by their respective types allows for a structured and readable presentation of their progression in the profile embed.
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

  return { categories, unknowns };
};
