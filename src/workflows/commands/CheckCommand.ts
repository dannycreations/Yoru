import { Util } from 'clashofclans.js';
import { EmbedBuilder } from 'discord.js';
import { Effect, Either, Option } from 'effect';

import { emoji } from '../../core/emojis';
import { ConfigStoreTag } from '../../core/schemas';
import { AccountDatabaseTag, UserDatabaseTag } from '../../database';
import { categorizeUnits, createPlayerEmbed, formatPlayerField, formatPlayerStats } from '../../helpers/ClashHelper';
import { addSplitFields, getGuildMember, parseMentionOrSnowflake } from '../../helpers/DiscordHelper';
import { ClashTag } from '../../services/ClashService';
import { MemberHandlerTag } from '../MemberHandler';

import type { Message } from 'discord.js';
import type { AccountTable } from '../../database/schema';

const checkProfile = (message: Message<true>, ownerId: string, accounts: ReadonlyArray<AccountTable>) =>
  Effect.gen(function* () {
    const memberHandler = yield* MemberHandlerTag;
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

    const results = yield* Effect.all(
      accounts.map((account) =>
        (account.bannedAt
          ? Effect.succeed({ tag: account.tag, banned: true as const, player: Option.none() })
          : memberHandler.getPlayer(account)
        ).pipe(Effect.either),
      ),
      { concurrency: 'unbounded' },
    );

    results.forEach((result, i) => {
      if (Either.isRight(result)) {
        const data = result.right;
        const count = i + 1;

        if (data.banned) {
          embed.addFields({
            name: `${count}. ${emoji.townhalls[0]} ${data.tag}`,
            value: '⛔ Has been banned!',
          });
        } else if (Option.isSome(data.player)) {
          const player = data.player.value;
          embed.addFields({
            name: `${count}. ${emoji.townhalls[player.townHallLevel - 1]} ${player.name}`,
            value: formatPlayerField(player),
          });
        }
      }
    });

    embed.setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() }).setTimestamp();
    yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
  });

const checkPlayer = (message: Message<true>, tag: string) =>
  Effect.gen(function* () {
    const clash = yield* ClashTag;
    const player = yield* clash.getPlayer(tag);
    const embed = createPlayerEmbed(player);

    const accountDatabase = yield* AccountDatabaseTag;
    const userDatabase = yield* UserDatabaseTag;

    const accountOpt = yield* accountDatabase.findOne({ tag });
    const isOwned = yield* Effect.gen(function* () {
      if (Option.isSome(accountOpt)) {
        const userOpt = yield* userDatabase.findOne({ id: accountOpt.value.userId });
        if (Option.isSome(userOpt)) {
          const member = message.guild.members.cache.get(userOpt.value.ownerId);
          return `👤 ${member ? member.user.tag : userOpt.value.ownerId}\n`;
        }
      }
      return '';
    });

    const statsValue = `${isOwned}${formatPlayerStats(player)}`;
    embed.addFields({
      name: 'Profiles',
      value: statsValue,
    });

    const { categories, unknowns } = categorizeUnits(player);

    Object.entries(categories).forEach(([name, list]) => {
      if (list.length > 0) addSplitFields(embed, name, list);
    });

    const achievements = player.achievements
      .filter((r) => ['Friend in Need', 'Games Champion'].includes(r.name))
      .map((a) => `${emoji.stars[a.stars]} **${a.name}** ${a.value.toLocaleString()}\n`)
      .join('');

    if (achievements) embed.addFields({ name: 'Achievements', value: achievements });

    if (unknowns.length > 0) yield* Effect.logWarning('Unknown assets detected', unknowns);

    yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
  });

const checkUser = (message: Message<true>, ownerId: string, page: number) =>
  Effect.gen(function* () {
    const accountDatabase = yield* AccountDatabaseTag;
    const userDatabase = yield* UserDatabaseTag;

    const userOpt = yield* userDatabase.findOne({ ownerId });
    const accounts = Option.isSome(userOpt) ? yield* accountDatabase.find({ userId: userOpt.value.id }) : [];

    if (Option.isNone(userOpt) || accounts.length === 0) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nThere is no tag linked to this user!`));
      return;
    }

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
    const { clanTags } = config;

    if (clanTags.length === 0) {
      yield* Effect.tryPromise(() => message.reply('No clans are currently configured.'));
      return;
    }

    const index = Math.max(0, Math.min(page - 1, clanTags.length - 1));

    const clan = yield* clash.getClan(clanTags[index]);
    const guildMap = new Map<string, string[]>();
    const leave: string[] = [];
    const unknown: string[] = [];

    const accountDatabase = yield* AccountDatabaseTag;
    const userDatabase = yield* UserDatabaseTag;

    const tags = clan.members.map((m) => m.tag);
    const accounts = yield* accountDatabase.find({ tag: { $in: tags } });
    const userIds = [...new Set(accounts.map((acc) => acc.userId).filter((id): id is number => id !== null))];
    const users = userIds.length > 0 ? yield* userDatabase.find({ id: { $in: userIds } }) : [];

    const accountMap = new Map(accounts.map((acc) => [acc.tag, acc]));
    const userMap = new Map(users.map((u) => [u.id, u]));

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

    memberResults.forEach((result) => {
      if (result.type === 'unknown') {
        unknown.push(result.field);
      } else if (result.type === 'leave') {
        leave.push(result.field);
      } else {
        const list = guildMap.get(result.ownerId) ?? [];
        if (!guildMap.has(result.ownerId)) guildMap.set(result.ownerId, list);
        list.push(result.field);
      }
    });

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`${clan.name} (${clan.tag})`)
      .setURL(`https://link.clashofclans.com/en?action=OpenClanProfile&tag=${clan.tag.replace('#', '')}`)
      .setThumbnail(clan.badge.url)
      .setDescription(`👥 **Total Members in Clan:** ${clan.memberCount}`)
      .setTimestamp();

    if (leave.length > 0) {
      embed.addFields({ name: `🖕 Members leave Discord (${leave.length})`, value: leave.join(' ').slice(0, 1024) });
    }

    if (guildMap.size > 0) {
      const field = [...guildMap.entries()]
        .map(([ownerId, members]) => `**<@${ownerId}>:**\n- ${members.map((m) => m.trim()).join('\n- ')}`)
        .join('\n')
        .slice(0, 1024);
      embed.addFields({ name: '👍 Members on Discord', value: field });
    }

    if (unknown.length > 0) {
      embed.addFields({ name: `👎 Members not on Discord (${unknown.length})`, value: unknown.join(' ').slice(0, 1024) });
    }

    yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
  });

export const checkCommand = (message: Message<true>, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const tag = args[0];
    const page = parseInt(args[1], 10) || 0;

    if (tag === undefined || tag === '') {
      yield* Effect.tryPromise(() => message.reply('Please provide a player tag or mention a user.'));
      return;
    }

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

        if (isOwner || tag.includes('<@')) {
          yield* checkUser(message, mentionId, page);
        } else {
          yield* Effect.tryPromise(() => message.reply('Invalid player tag!'));
        }
      } else {
        yield* Effect.tryPromise(() => message.reply('Invalid player tag!'));
      }
    }
  }).pipe(Effect.asVoid);
