import { Util } from 'clashofclans.js';
import { EmbedBuilder } from 'discord.js';
import { Array, Effect, Either, Option, Record } from 'effect';

import { EmojiTag } from '../../core/emojis.js';
import { ConfigStoreTag } from '../../core/schemas.js';
import { AccountDatabaseTag, UserDatabaseTag } from '../../database/index.js';
import { userTable } from '../../database/schema.js';
import { categorizeUnits, createPlayerEmbed, formatPlayerField, formatPlayerStats } from '../../helpers/ClashHelper.js';
import { getGuildMember, getSplitFields, parseMentionOrSnowflake, replyMessage } from '../../helpers/DiscordHelper.js';
import { ClashClientTag } from '../../services/ClashService.js';
import { MemberHandlerTag } from '../MemberHandler.js';

import type { Message } from 'discord.js';
import type { AccountTable } from '../../database/schema.js';

const checkProfile = (message: Message<true>, ownerId: string, accounts: ReadonlyArray<AccountTable>) =>
  Effect.gen(function* () {
    const emoji = yield* EmojiTag;
    const memberHandler = yield* MemberHandlerTag;
    const memberOpt = yield* getGuildMember(ownerId, message.guild);

    if (Option.isNone(memberOpt)) {
      return yield* replyMessage(message, `> ${message.content}\nUser leaving discord server!`);
    }

    const member = memberOpt.value;
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setDescription(`Joined <t:${Math.floor(member.joinedTimestamp! / 1000)}:R>`)
      .setThumbnail(member.user.displayAvatarURL());

    const results = yield* Effect.all(
      Array.map(accounts, (account) =>
        (account.bannedAt
          ? Effect.succeed({ tag: account.tag, banned: true as const, player: Option.none() })
          : memberHandler.getPlayer(account)
        ).pipe(Effect.either),
      ),
      { concurrency: 'inherit' },
    );

    const fields = yield* Effect.all(
      Array.map(results, (result, i) =>
        Effect.gen(function* () {
          if (Either.isLeft(result)) return Option.none();
          const data = result.right;
          const count = i + 1;

          if (data.banned) {
            return Option.some({
              name: `${count}. ${emoji.townhalls[0]} ${data.tag}`,
              value: '⛔ Has been banned!',
            });
          }

          if (Option.isNone(data.player)) return Option.none();
          const player = data.player.value;
          const field = yield* formatPlayerField(player);
          return Option.some({
            name: `${count}. ${emoji.townhalls[player.townHallLevel - 1]} ${player.name}`,
            value: field,
          });
        }),
      ),
      { concurrency: 'inherit' },
    ).pipe(Effect.map((arr) => Array.flatten(Array.map(arr, (o) => (Option.isSome(o) ? [o.value] : [])))));

    if (fields.length > 0) {
      embed.addFields([...fields]);
    }

    embed.setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() }).setTimestamp();
    yield* replyMessage(message, { embeds: [embed] });
  });

const checkPlayer = (message: Message<true>, tag: string) =>
  Effect.gen(function* () {
    const emoji = yield* EmojiTag;
    const clash = yield* ClashClientTag;
    const player = yield* clash.getPlayer(tag);
    const embed = yield* createPlayerEmbed(player);

    const accountDatabase = yield* AccountDatabaseTag;

    const rowOpt = yield* accountDatabase.findOne(
      { tag },
      { joins: [{ table: userTable, on: { userId: 'id' }, type: 'inner' }], select: { ownerId: 1 } },
    );
    const isOwned = Option.match(rowOpt, {
      onNone: () => '',
      onSome: (row) => {
        const member = message.guild.members.cache.get(row.ownerId);
        return `👤 ${member ? member.user.tag : row.ownerId}\n`;
      },
    });

    const statsValue = `${isOwned}${yield* formatPlayerStats(player)}`;
    embed.addFields({
      name: 'Profiles',
      value: statsValue,
    });

    const { categories, unknowns } = yield* categorizeUnits(player);

    Array.forEach(Record.toEntries(categories), ([name, list]) => {
      if (list.length === 0) {
        return;
      }

      embed.addFields([...getSplitFields(name, list)]);
    });

    const achievements = Array.join(
      Array.map(
        Array.filter(player.achievements, (r) => ['Friend in Need', 'Games Champion'].includes(r.name)),
        (a) => `${emoji.stars[a.stars]} **${a.name}** ${a.value.toLocaleString()}\n`,
      ),
      '',
    );

    if (achievements) embed.addFields({ name: 'Achievements', value: achievements });

    if (unknowns.length > 0) yield* Effect.logWarning('Unknown assets detected', unknowns);

    yield* replyMessage(message, { embeds: [embed] });
  });

const checkUser = (message: Message<true>, ownerId: string, page: number) =>
  Effect.gen(function* () {
    const accountDatabase = yield* AccountDatabaseTag;
    const userDatabase = yield* UserDatabaseTag;

    const userOpt = yield* userDatabase.findOne({ ownerId });
    const accounts = Option.isSome(userOpt) ? yield* accountDatabase.find({ userId: userOpt.value.id }) : [];

    if (Option.isNone(userOpt) || accounts.length === 0) {
      return yield* replyMessage(message, `> ${message.content}\nThere is no tag linked to this user!`);
    }

    if (page > 0 && page <= accounts.length) {
      yield* checkPlayer(message, accounts[page - 1].tag);
      return;
    }

    yield* checkProfile(message, ownerId, accounts);
  });

const checkMembers = (message: Message<true>, page = 1) =>
  Effect.gen(function* () {
    const clash = yield* ClashClientTag;
    const configStore = yield* ConfigStoreTag;
    const config = yield* configStore.get;
    const { clanTags } = config;

    if (clanTags.length === 0) {
      return yield* replyMessage(message, 'No clans are currently configured.');
    }

    const index = Math.max(0, Math.min(page - 1, clanTags.length - 1));

    const clan = yield* clash.getClan(clanTags[index]);
    const accountDatabase = yield* AccountDatabaseTag;

    const members = clan.members;
    const tags = members.map((m) => m.tag);

    const rows = yield* accountDatabase.find(
      { tag: { $in: tags } },
      { joins: [{ table: userTable, on: { userId: 'id' }, type: 'inner' }], select: { tag: 1, userId: 1, ownerId: 1 } },
    );
    const accountMap = new Map(rows.map((r) => [r.tag, r]));

    const memberResults = yield* Effect.all(
      members.map((member) =>
        Effect.gen(function* () {
          const field = `**${member.name}** ${member.tag}\n`;
          const account = accountMap.get(member.tag);
          if (!account) return { type: 'unknown' as const, field };

          const cachedMember = message.guild.members.cache.get(account.ownerId);
          if (cachedMember) return { type: 'guild' as const, ownerId: account.ownerId, field };

          return { type: 'fetch' as const, ownerId: account.ownerId, field };
        }),
      ),
      { concurrency: 'inherit' },
    );

    const membersToFetch = [...new Set(Array.filterMap(memberResults, (r) => (r.type === 'fetch' ? Option.some(r.ownerId) : Option.none())))];

    if (membersToFetch.length > 0) {
      yield* Effect.tryPromise(() => message.guild.members.fetch({ user: membersToFetch })).pipe(Effect.ignore);
    }

    const finalResults = memberResults.map((r) => {
      if (r.type !== 'fetch') return r;
      const member = message.guild.members.cache.get(r.ownerId);
      return member ? { type: 'guild' as const, ownerId: r.ownerId, field: r.field } : { type: 'leave' as const, field: r.field };
    });

    const guildMap = new Map<string, string[]>();
    const leave: string[] = [];
    const unknown: string[] = [];

    for (const result of finalResults) {
      switch (result.type) {
        case 'unknown':
          unknown.push(result.field);
          break;
        case 'leave':
          leave.push(result.field);
          break;
        case 'guild': {
          const list = guildMap.get(result.ownerId) ?? [];
          list.push(result.field);
          guildMap.set(result.ownerId, list);
          break;
        }
      }
    }

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
      const field = Array.join(
        Array.map(
          Array.fromIterable(guildMap.entries()),
          ([ownerId, members]) =>
            `**<@${ownerId}>:**\n- ${Array.join(
              Array.map(members, (m) => m.trim()),
              '\n- ',
            )}`,
        ),
        '\n',
      ).slice(0, 1024);
      embed.addFields({ name: '👍 Members on Discord', value: field });
    }

    if (unknown.length > 0) {
      embed.addFields({ name: `👎 Members not on Discord (${unknown.length})`, value: unknown.join(' ').slice(0, 1024) });
    }

    yield* replyMessage(message, { embeds: [embed] });
  });

export const checkCommand = (message: Message<true>, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const tag = args[0];
    const page = parseInt(args[1], 10) || 0;

    if (tag === undefined || tag === '') {
      return yield* replyMessage(message, 'Please provide a player tag or mention a user.');
    }

    if (/member/i.test(tag)) {
      return yield* checkMembers(message, page);
    }

    if (Util.isValidTag(tag)) {
      return yield* checkPlayer(message, tag);
    }

    const mentionId = parseMentionOrSnowflake(tag);
    if (!mentionId) {
      return yield* replyMessage(message, 'Invalid player tag!');
    }

    const configStore = yield* ConfigStoreTag;
    const config = yield* configStore.get;
    const isOwner = Array.contains(config.ownerIds, message.author.id);

    if (isOwner || Array.contains(tag, '<@')) {
      return yield* checkUser(message, mentionId, page);
    }

    yield* replyMessage(message, 'Invalid player tag!');
  }).pipe(Effect.asVoid);
