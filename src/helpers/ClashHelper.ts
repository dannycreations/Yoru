import { EmbedBuilder } from 'discord.js';
import { Context, Effect, Layer } from 'effect';

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

class UnitLookupTag extends Context.Tag('@helpers/UnitLookup')<UnitLookupTag, Map<string, { readonly category: string; readonly emoji: string }>>() {}

const makeUnitLookup = Effect.gen(function* () {
  const emoji = yield* EmojiTag;
  return new Map<string, { readonly category: string; readonly emoji: string }>([
    ...Object.entries(emoji.troops.normal).map(([name, emoji]) => [name, { category: 'Troops', emoji }] as const),
    ...Object.entries(emoji.troops.dark).map(([name, emoji]) => [name, { category: 'Dark Troops', emoji }] as const),
    ...Object.entries(emoji.troops.super).map(([name, emoji]) => [name, { category: 'Super Troops', emoji }] as const),
    ...Object.entries(emoji.troops.siege).map(([name, emoji]) => [name, { category: 'Siege Machines', emoji }] as const),
    ...Object.entries(emoji.troops.pets).map(([name, emoji]) => [name, { category: 'Pets', emoji }] as const),
    ...Object.entries(emoji.spells.normal).map(([name, emoji]) => [name, { category: 'Spells', emoji }] as const),
    ...Object.entries(emoji.spells.dark).map(([name, emoji]) => [name, { category: 'Dark Spells', emoji }] as const),
    ...Object.entries(emoji.heroes).map(([name, emoji]) => [name, { category: 'Heroes', emoji }] as const),
  ]);
});

export const categorizeUnits = (player: Player) =>
  Effect.gen(function* () {
    const lookup = yield* UnitLookupTag;

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

    const rawUnits = [...player.troops, ...player.spells, ...player.heroes];

    for (const unit of rawUnits) {
      if (unit.village !== 'home') continue;

      const mapping = lookup.get(unit.name);
      if (mapping) {
        categories[mapping.category].push(`${mapping.emoji}**${unit.level}**/${unit.maxLevel}`);
      } else {
        unknowns.push(unit);
      }
    }

    return { categories, unknowns };
  }).pipe(Effect.provide(Layer.effect(UnitLookupTag, makeUnitLookup)));
