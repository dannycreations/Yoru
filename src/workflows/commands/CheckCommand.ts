import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { isErrorLike } from '@vegapunk/utilities/result';
import { Util } from 'clashofclans.js';
import { EmbedBuilder } from 'discord.js';
import { Effect, Option } from 'effect';

import { emoji } from '../../core/emojis';
import { ConfigStoreTag } from '../../core/schemas';
import { AccountAdapter, UserAdapter } from '../../database';
import { categorizeUnits, formatPlayerStats, parseClan } from '../../helpers/clash.helper';
import { getGuildMember } from '../../helpers/discord.helper';
import { ClashTag } from '../../services/ClashService';

import type { Message } from 'discord.js';
import type { AccountTable } from '../../database/schema';

const checkProfile = (message: Message<true>, ownerId: string, accounts: AccountTable[]) =>
  Effect.gen(function* () {
    const { client: clash } = yield* ClashTag;
    const member = message.guild.members.cache.get(ownerId);
    if (!member) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nUser leaving discord server!`));
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setDescription(`Joined <t:${Math.floor(member.joinedTimestamp! / 1000)}:R>`)
      .setThumbnail(member.user.displayAvatarURL());

    let count = 0;
    for (const account of accounts) {
      if (account.bannedAt) {
        embed.addFields({
          name: `${++count}. ${emoji.townhalls[0]} ${account.tag}`,
          value: '⛔ Has been banned!',
        });
        continue;
      }

      try {
        let field = '';
        const player = yield* Effect.tryPromise(() => clash.getPlayer(account.tag));
        field += `${emoji.hashtag} ${player.tag}\n`;
        field += formatPlayerStats(player) + '\n';
        field += player.clan ? `${emoji.isclan.true} ${player.clan.name}` : `${emoji.isclan.false} Player is clanless`;

        embed.addFields({
          name: `${++count}. ${emoji.townhalls[player.townHallLevel - 1]} ${player.name}`,
          value: field,
        });
      } catch (error) {
        // If the player is not found, mark the account as banned (likely deleted or permanently banned)
        if (isErrorLike<{ reason: string }>(error) && error.reason === 'notFound') {
          yield* AccountAdapter.update({ ...account, bannedAt: Date.now() });
          embed.addFields({
            name: `${++count}. ${emoji.townhalls[0]} ${account.tag}`,
            value: '⛔ Has been banned!',
          });
        }
      }
    }

    embed.setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() }).setTimestamp();
    yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
  });

const checkPlayer = (message: Message<true>, tag: string) =>
  Effect.gen(function* () {
    const { client: clash } = yield* ClashTag;
    const player = yield* Effect.tryPromise(() => clash.getPlayer(tag));
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Open in Clash of Clans ↗')
      .setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${tag}`);

    const thumbLeague = player.leagueTier ? player.leagueTier.icon.medium : emoji.thumbnail.replace('{0}', 'badges/noleague.png');
    embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague });
    embed.setThumbnail(emoji.thumbnail.replace('{0}', `townhalls/townhall-${player.townHallLevel}.png`));

    const account = yield* AccountAdapter.findOne({ tag });
    let isOwned = '';
    if (account) {
      const user = yield* UserAdapter.findOne({ id: account.userId });
      if (user) {
        const member = message.guild.members.cache.get(user.ownerId);
        isOwned = `👤 ${member ? member.user.tag : user.ownerId}\n`;
      }
    }

    embed.addFields({
      name: 'Profiles',
      value: `${isOwned}${formatPlayerStats(player)}`,
    });

    const { categories, unknowns } = categorizeUnits(player);

    Object.entries(categories).forEach(([name, list]) => {
      if (list.length) embed.addFields({ name, value: list.join(' ') });
    });

    const achievements: string[] = [];
    const achievementsName = ['Friend in Need', 'Games Champion'];
    player.achievements
      .filter((r) => achievementsName.includes(r.name))
      .forEach((achievement) => {
        achievements.push(emoji.stars[achievement.stars] + ' **' + achievement.name + '** ' + achievement.value.toLocaleString() + '\n');
      });

    if (achievements.length) embed.addFields({ name: 'Achievements', value: achievements.join('') });

    if (unknowns.length) yield* Effect.logWarning('Unknown assets detected:', unknowns);

    embed.setFooter(parseClan(player));
    yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
  });

const checkUser = (message: Message<true>, ownerId: string, page: number) =>
  Effect.gen(function* () {
    const user = yield* UserAdapter.findOne({ ownerId });
    if (!user) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nThere is no tag linked to this user!`));
      return;
    }

    const accounts = yield* AccountAdapter.find({ userId: user.id });
    if (!accounts.length) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nThere is no tag linked to this user!`));
    } else if (page >= 1 && page <= accounts.length) {
      yield* checkPlayer(message, accounts[page - 1].tag);
    } else {
      yield* checkProfile(message, ownerId, accounts);
    }
  });

const checkMembers = (message: Message<true>, page = 1) =>
  Effect.gen(function* () {
    const { client: clash } = yield* ClashTag;
    const configStore = yield* ConfigStoreTag;
    const config = yield* configStore.get;
    const clanTags = config.clanTags;
    const index = Math.max(0, Math.min(page - 1, clanTags.length - 1));

    const clan = yield* Effect.tryPromise(() => clash.getClan(clanTags[index]));
    const guildMap = new Map<string, string[]>();
    const leave: string[] = [];
    const unknown: string[] = [];

    for (const member of clan.members) {
      const field = `**${member.name}** ${member.tag}\n`;
      const account = yield* AccountAdapter.findOne({ tag: member.tag });
      const userId = account?.userId;

      if (userId) {
        const user = yield* UserAdapter.findOne({ id: userId });
        if (user) {
          const memberOpt = yield* getGuildMember(user.ownerId);
          if (Option.isSome(memberOpt)) {
            if (!guildMap.has(user.ownerId)) guildMap.set(user.ownerId, []);
            guildMap.get(user.ownerId)!.push(field);
          } else {
            leave.push(field);
          }
          continue;
        }
      }
      unknown.push(field);
    }

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`${clan.name} (${clan.tag})`)
      .setURL(`https://link.clashofclans.com/en?action=OpenClanProfile&tag=${clan.tag.replace('#', '')}`)
      .setThumbnail(clan.badge.url)
      .setDescription(`👥 **Total Members in Clan:** ${clan.memberCount}`)
      .setTimestamp();

    if (leave.length) {
      embed.addFields({ name: `🖕 Members leave Discord (${leave.length})`, value: leave.join(' ').slice(0, 1024) });
    }

    if (guildMap.size) {
      const field = [...guildMap.entries()]
        .map(([ownerId, members]) => `**<@${ownerId}>:**\n- ${members.map((m) => m.trim()).join('\n- ')}`)
        .join('\n')
        .slice(0, 1024);
      embed.addFields({ name: '👍 Members on Discord', value: field });
    }

    if (unknown.length) {
      embed.addFields({ name: `👎 Members not on Discord (${unknown.length})`, value: unknown.join(' ').slice(0, 1024) });
    }

    yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
  });

export const checkCommand = (message: Message<true>, args: string[]) =>
  Effect.gen(function* () {
    const tag = args[0];
    const page = parseInt(args[1] || '0', 10);

    if (!tag) {
      yield* Effect.tryPromise(() => message.reply('Please provide a player tag or mention a user.'));
      return;
    }

    if (/member/i.test(tag)) {
      yield* checkMembers(message, page);
    } else if (Util.isValidTag(tag)) {
      yield* checkPlayer(message, tag);
    } else {
      const mentionId = tag.match(UserOrMemberMentionRegex)?.[1];
      if (mentionId) {
        yield* checkUser(message, mentionId, page);
      } else if (SnowflakeRegex.test(tag)) {
        const configStore = yield* ConfigStoreTag;
        const config = yield* configStore.get;
        if (config.ownerIds.includes(message.author.id)) {
          yield* checkUser(message, tag, page);
        }
      } else {
        yield* Effect.tryPromise(() => message.reply('Invalid player tag!'));
      }
    }
  });
