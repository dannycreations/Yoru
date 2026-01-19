import { EmbedBuilder } from 'discord.js';
import { Array } from 'effect';

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

const UNIT_LOOKUP: ReadonlyMap<string, { readonly category: string; readonly emoji: string }> = new Map<
  string,
  { readonly category: string; readonly emoji: string }
>([
  ...Object.entries(emoji.troops.normal).map(([name, emoji]) => [name, { category: 'Troops', emoji }] as const),
  ...Object.entries(emoji.troops.dark).map(([name, emoji]) => [name, { category: 'Dark Troops', emoji }] as const),
  ...Object.entries(emoji.troops.super).map(([name, emoji]) => [name, { category: 'Super Troops', emoji }] as const),
  ...Object.entries(emoji.troops.siege).map(([name, emoji]) => [name, { category: 'Siege Machines', emoji }] as const),
  ...Object.entries(emoji.troops.pets).map(([name, emoji]) => [name, { category: 'Pets', emoji }] as const),
  ...Object.entries(emoji.spells.normal).map(([name, emoji]) => [name, { category: 'Spells', emoji }] as const),
  ...Object.entries(emoji.spells.dark).map(([name, emoji]) => [name, { category: 'Dark Spells', emoji }] as const),
  ...Object.entries(emoji.heroes).map(([name, emoji]) => [name, { category: 'Heroes', emoji }] as const),
]);

export const categorizeUnits = (player: Player) => {
  const units = Array.filter([...player.troops, ...player.spells, ...player.heroes], (u) => u.village === 'home');

  return Array.reduce(
    units,
    {
      categories: {
        Troops: [] as string[],
        'Dark Troops': [] as string[],
        'Super Troops': [] as string[],
        'Siege Machines': [] as string[],
        Pets: [] as string[],
        Spells: [] as string[],
        'Dark Spells': [] as string[],
        Heroes: [] as string[],
      },
      unknowns: [] as unknown[],
    },
    (acc, unit) => {
      const mapping = UNIT_LOOKUP.get(unit.name);
      if (mapping) {
        return {
          ...acc,
          categories: {
            ...acc.categories,
            [mapping.category]: [
              ...(acc.categories[mapping.category as keyof typeof acc.categories] ?? []),
              `${mapping.emoji}**${unit.level}**/${unit.maxLevel}`,
            ],
          },
        };
      }
      return { ...acc, unknowns: [...acc.unknowns, unit] };
    },
  );
};
