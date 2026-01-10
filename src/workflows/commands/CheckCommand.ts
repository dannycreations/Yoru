import { isErrorLike } from '@vegapunk/utilities/result';
import { Util } from 'clashofclans.js';
import { EmbedBuilder } from 'discord.js';
import { Effect, Option } from 'effect';

import { emoji } from '../../core/emojis';
import { ConfigStoreTag } from '../../core/schemas';
import { AccountAdapter, UserAdapter } from '../../database';
import { categorizeUnits, createPlayerEmbed, formatPlayerField, formatPlayerStats } from '../../helpers/clash.helper';
import { getGuildMember, parseMentionOrSnowflake } from '../../helpers/discord.helper';
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
        const player = yield* Effect.tryPromise(() => clash.getPlayer(account.tag));

        // Centralized formatting helpers maintain a consistent layout for player summaries within the profile overview.
        const fieldName = `${++count}. ${emoji.townhalls[player.townHallLevel - 1]} ${player.name}`;
        embed.addFields({
          name: fieldName,
          value: formatPlayerField(player),
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
    const embed = createPlayerEmbed(player);

    const account = yield* AccountAdapter.findOne({ tag });
    let isOwned = '';
    if (account) {
      const user = yield* UserAdapter.findOne({ id: account.userId });
      if (user) {
        const member = message.guild.members.cache.get(user.ownerId);
        isOwned = `👤 ${member ? member.user.tag : user.ownerId}\n`;
      }
    }

    // Ownership status and basic player statistics serve as the primary profile information.
    const statsValue = `${isOwned}${formatPlayerStats(player)}`;
    embed.addFields({
      name: 'Profiles',
      value: statsValue,
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

    // Default embed formatting, including the clan footer, is applied during creation to ensure consistent presentation.
    yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
  });

const checkUser = (message: Message<true>, ownerId: string, page: number) =>
  Effect.gen(function* () {
    const user = yield* UserAdapter.findOne({ ownerId });
    const accounts = user ? yield* AccountAdapter.find({ userId: user.id }) : [];

    // Verification of linked accounts ensures that users receive a clear error message when no data is available.
    if (!user || accounts.length === 0) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nThere is no tag linked to this user!`));
      return;
    }

    // Provision of a valid page number triggers a detailed player view, while the absence of one defaults to the profile summary.
    if (page > 0 && page <= accounts.length) {
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

    // Batch retrieval of account and user records for all clan members minimizes database round-trips and improves command response time.
    const tags = clan.members.map((m) => m.tag);
    const accounts = yield* AccountAdapter.find({ tag: { $in: tags } });
    // Deduplicating user IDs before querying the database reduces the load on the adapter and ensures a more efficient retrieval process.
    const userIds = [...new Set(accounts.map((acc) => acc.userId).filter((id): id is number => id !== null))];
    const users = userIds.length > 0 ? yield* UserAdapter.find({ id: { $in: userIds } }) : [];

    const accountMap = new Map(accounts.map((acc) => [acc.tag, acc]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    for (const member of clan.members) {
      const field = `**${member.name}** ${member.tag}\n`;
      const account = accountMap.get(member.tag);
      const user = account?.userId ? userMap.get(account.userId) : null;

      if (user) {
        const memberOpt = yield* getGuildMember(user.ownerId);
        if (Option.isSome(memberOpt)) {
          if (!guildMap.has(user.ownerId)) guildMap.set(user.ownerId, []);
          guildMap.get(user.ownerId)!.push(field);
        } else {
          leave.push(field);
        }
      } else {
        unknown.push(field);
      }
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

    // A guard clause for missing input reduces nesting and improves readability.
    if (tag === undefined || tag === '') {
      yield* Effect.tryPromise(() => message.reply('Please provide a player tag or mention a user.'));
      return;
    }

    // The requested check type is identified as clan members, a specific player tag, or a Discord user.
    if (/member/i.test(tag)) {
      yield* checkMembers(message, page);
    } else if (Util.isValidTag(tag)) {
      yield* checkPlayer(message, tag);
    } else {
      const mentionId = parseMentionOrSnowflake(tag);
      if (mentionId) {
        const configStore = yield* ConfigStoreTag;
        const config = yield* configStore.get;
        const isOwner = config.ownerIds.includes(message.author.id);

        // Authorization check: only owners can look up users by raw ID.
        // Direct mentions are allowed for everyone to facilitate ease of use.
        if (isOwner || tag.includes('<@')) {
          yield* checkUser(message, mentionId, page);
        } else {
          yield* Effect.tryPromise(() => message.reply('Invalid player tag!'));
        }
      } else {
        yield* Effect.tryPromise(() => message.reply('Invalid player tag!'));
      }
    }
  });
