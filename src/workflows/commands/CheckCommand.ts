import { Util } from 'clashofclans.js';
import { EmbedBuilder } from 'discord.js';
import { Effect, Option } from 'effect';

import { emoji } from '../../core/emojis';
import { ConfigStoreTag } from '../../core/schemas';
import { AccountAdapter, UserAdapter } from '../../database';
import { MemberManagerTag } from '../../domain/MemberManager';
import { categorizeUnits, createPlayerEmbed, formatPlayerField, formatPlayerStats } from '../../helpers/clash.helper';
import { addSplitFields, getGuildMember, parseMentionOrSnowflake } from '../../helpers/discord.helper';
import { ClashTag } from '../../services/ClashService';

import type { Message } from 'discord.js';
import type { AccountTable } from '../../database/schema';

const checkProfile = (message: Message<true>, ownerId: string, accounts: AccountTable[]) =>
  Effect.gen(function* () {
    const memberManager = yield* MemberManagerTag;
    const memberOpt = yield* getGuildMember(ownerId, message.guild);
    if (Option.isNone(memberOpt)) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nUser leaving discord server!`));
      return;
    }
    const member = memberOpt.value;

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setDescription(`Joined <t:${Math.floor(member.joinedTimestamp! / 1000)}:R>`)
      .setThumbnail(member.user.displayAvatarURL());

    // Parallelizing player data retrieval significantly reduces the total response time for profiles with multiple linked accounts.
    const results = yield* Effect.all(
      accounts.map((account) =>
        (account.bannedAt ? Effect.succeed({ tag: account.tag, banned: true as const, player: null }) : memberManager.getPlayer(account)).pipe(
          Effect.either,
        ),
      ),
      { concurrency: 'unbounded' },
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result._tag === 'Left') continue;

      const data = result.right;
      const count = i + 1;

      if (data.banned) {
        embed.addFields({
          name: `${count}. ${emoji.townhalls[0]} ${data.tag}`,
          value: '⛔ Has been banned!',
        });
      } else if (data.player) {
        embed.addFields({
          name: `${count}. ${emoji.townhalls[data.player.townHallLevel - 1]} ${data.player.name}`,
          value: formatPlayerField(data.player),
        });
      }
    }

    embed.setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() }).setTimestamp();
    yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
  });

const checkPlayer = (message: Message<true>, tag: string) =>
  Effect.gen(function* () {
    const clash = yield* ClashTag;
    const player = yield* clash.getPlayer(tag);
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
      if (list.length) addSplitFields(embed, name, list);
    });

    // Filtering for specific high-value achievements provides a concise summary of player activity without overwhelming the profile embed.
    const achievements = player.achievements
      .filter((r) => ['Friend in Need', 'Games Champion'].includes(r.name))
      .map((a) => `${emoji.stars[a.stars]} **${a.name}** ${a.value.toLocaleString()}\n`)
      .join('');

    if (achievements) embed.addFields({ name: 'Achievements', value: achievements });

    if (unknowns.length) yield* Effect.logWarning('Unknown assets detected', unknowns);

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
    const clash = yield* ClashTag;
    const configStore = yield* ConfigStoreTag;
    const config = yield* configStore.get;
    const clanTags = config.clanTags;

    // Verifying that at least one clan is configured prevents index-out-of-bounds errors and provides immediate feedback to the user.
    if (clanTags.length === 0) {
      yield* Effect.tryPromise(() => message.reply('No clans are currently configured.'));
      return;
    }

    const index = Math.max(0, Math.min(page - 1, clanTags.length - 1));

    const clan = yield* clash.getClan(clanTags[index]);
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

    // Parallel resolution of Discord member status for all clan members optimizes the generation of the summary embed while maintaining thread-safe result aggregation.
    const memberResults = yield* Effect.all(
      clan.members.map((member) =>
        Effect.gen(function* () {
          const field = `**${member.name}** ${member.tag}\n`;
          const account = accountMap.get(member.tag);
          const user = account?.userId ? userMap.get(account.userId) : null;
          if (!user) return { type: 'unknown' as const, field };

          const memberOpt = yield* getGuildMember(user.ownerId, message.guild);
          if (Option.isNone(memberOpt)) return { type: 'leave' as const, field };

          return { type: 'guild' as const, ownerId: user.ownerId, field };
        }),
      ),
      { concurrency: 'unbounded' },
    );

    for (const result of memberResults) {
      if (result.type === 'unknown') {
        unknown.push(result.field);
      } else if (result.type === 'leave') {
        leave.push(result.field);
      } else {
        const list = guildMap.get(result.ownerId) ?? [];
        if (!guildMap.has(result.ownerId)) guildMap.set(result.ownerId, list);
        list.push(result.field);
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
    const page = parseInt(args[1], 10) || 0;

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
