import { EmbedBuilder } from 'discord.js';
import { Effect } from 'effect';

import { MemberRoles } from '../core/constants';
import { EmojiTag } from '../core/emojis';

import type { ValueOf } from '@vegapunk/utilities';
import type { Player } from 'clashofclans.js';
import type { GuildMember } from 'discord.js';
import type { Emoji } from '../core/schemas';

const CLAN_ROLE_MAP: Readonly<Record<string, ValueOf<typeof MemberRoles>>> = {
  leader: MemberRoles.Leader,
  coLeader: MemberRoles.CoLeader,
  elder: MemberRoles.Elder,
} as const;

const getThumbnailUrl = (emoji: Emoji, name: string): string => emoji.thumbnail.replace('{0}', name);

export const getPlayerNickname = (member: GuildMember, player: { readonly name: string; readonly tag: string }): string => {
  const isSameName = member.user.username.toLowerCase() === player.name.toLowerCase();
  return isSameName ? `${player.name} ${player.tag}` : player.name;
};

export const parseClan = (player: Player) =>
  Effect.gen(function* () {
    const emoji = yield* EmojiTag;
    if (player.clan) {
      const role = (player.role && CLAN_ROLE_MAP[player.role]) ?? MemberRoles.Member;
      const text = `${role} of ${player.clan.name}\n(${player.clan.tag})`;
      const iconURL = player.clan.badge.url;
      return { text, iconURL };
    }

    return {
      text: 'Player is clanless',
      iconURL: getThumbnailUrl(emoji, 'badges/noclan.png'),
    };
  });

export const formatPlayerStats = (player: Player) =>
  Effect.gen(function* () {
    const emoji = yield* EmojiTag;
    const level = `${emoji.level} ${player.expLevel}`;
    const trophies = `${emoji.trophies} ${player.trophies.toLocaleString()}`;
    const attacks = `${emoji.attackwin} ${player.attackWins.toLocaleString()}`;
    return `${level} ${trophies} ${attacks}`;
  });

export const formatPlayerField = (player: Player) =>
  Effect.gen(function* () {
    const emoji = yield* EmojiTag;
    const stats = yield* formatPlayerStats(player);
    const clanInfo = player.clan ? `${emoji.isclan.true} ${player.clan.name}` : `${emoji.isclan.false} Player is clanless`;
    return `${emoji.hashtag} ${player.tag}\n${stats}\n${clanInfo}`;
  });

export const createPlayerEmbed = (player: Player) =>
  Effect.gen(function* () {
    const emoji = yield* EmojiTag;
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Open in Clash of Clans ↗')
      .setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${player.tag.replace('#', '')}`);

    const thumbLeague = player.leagueTier ? player.leagueTier.icon.medium : getThumbnailUrl(emoji, 'badges/noleague.png');
    embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague });
    embed.setThumbnail(getThumbnailUrl(emoji, `townhalls/townhall-${player.townHallLevel}.png`));

    embed.setFooter(yield* parseClan(player));

    return embed;
  });

export const categorizeUnits = (player: Player) =>
  Effect.gen(function* () {
    const emoji = yield* EmojiTag;

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

    const UNIT_LOOKUP = new Map<string, { readonly category: string; readonly emoji: string }>();
    const addMapping = (source: Record<string, string>, category: string) => {
      for (const [name, icon] of Object.entries(source)) {
        UNIT_LOOKUP.set(name, { category, emoji: icon });
      }
    };

    addMapping(emoji.troops.normal, 'Troops');
    addMapping(emoji.troops.dark, 'Dark Troops');
    addMapping(emoji.troops.super, 'Super Troops');
    addMapping(emoji.troops.siege, 'Siege Machines');
    addMapping(emoji.troops.pets, 'Pets');
    addMapping(emoji.spells.normal, 'Spells');
    addMapping(emoji.spells.dark, 'Dark Spells');
    addMapping(emoji.heroes, 'Heroes');

    const rawUnits = [...player.troops, ...player.spells, ...player.heroes];

    for (const unit of rawUnits) {
      if (unit.village !== 'home') continue;

      const mapping = UNIT_LOOKUP.get(unit.name);
      if (mapping) {
        categories[mapping.category].push(`${mapping.emoji}**${unit.level}**/${unit.maxLevel}`);
      } else {
        unknowns.push(unit);
      }
    }

    return { categories, unknowns };
  });
