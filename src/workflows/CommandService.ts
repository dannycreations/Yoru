import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { HTTPError, Util } from 'clashofclans.js';
import { EmbedBuilder } from 'discord.js';
import { Context, Effect, Layer, Option } from 'effect';

import { emoji } from '../core/emojis';
import { categorizeUnits, formatPlayerStats, parseClan } from '../helpers/clash.helper';
import { getGuildMember } from '../helpers/discord.helper';
import { isModeratorRole, isRegisterRole } from '../helpers/role.helper';
import { ClashApiError, ClashClientTag } from '../services/ClashService';
import { ConfigStore } from '../services/ConfigService';
import { AccountAdapter, SqliteDatabase, UserAdapter } from '../services/database';
import { DiscordClientTag } from './DiscordService';

import type { Player } from 'clashofclans.js';
import type { User as DiscordUser, Message, MessageReaction } from 'discord.js';
import type { DiscordService } from './DiscordService';

export interface CommandContext {
  message: Message<true>;
  args: string[];
}

export interface CommandService {
  readonly handleCommand: (message: Message<true>) => Effect.Effect<void, any, SqliteDatabase | DiscordService>;
}

export const CommandServiceTag = Context.GenericTag<CommandService>('@services/CommandService');

export const CommandService = Effect.gen(function* () {
  const { client: discord } = yield* DiscordClientTag;
  const { client: clash } = yield* ClashClientTag;
  const configStore = yield* ConfigStore;

  const pingCommand = (message: Message<true>) =>
    Effect.gen(function* () {
      const msg = yield* Effect.tryPromise(() => message.reply('ping?'));
      const botLatency = Math.round(discord.ws.ping);
      const apiLatency = msg.createdTimestamp - message.createdTimestamp;
      yield* Effect.tryPromise(() => msg.edit(`Pong! BOT Latency ${botLatency}ms. API Latency ${apiLatency}ms.`));
    });

  const checkProfile = (message: Message<true>, ownerId: string, accounts: any[]) =>
    Effect.gen(function* () {
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
        if (account.bannedAt) continue;

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
          if (error && typeof error === 'object' && 'reason' in error && error.reason === 'notFound') {
            yield* AccountAdapter.update({ ...account, bannedAt: Date.now() });
          }
        } finally {
          if (account.bannedAt) {
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
      const config = yield* configStore.get;
      const clanTags = config.clanTags;
      if (page < 1 || page > clanTags.length) page = 1;

      const clan = yield* Effect.tryPromise(() => clash.getClan(clanTags[page - 1]));
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

      let response = `**### ${clan.name} (${clan.tag})**\n👥 **Total Members in Clan:** ${clan.memberCount}\n\n`;
      if (leave.length) response += `🖕 **Members leave Discord:** ${leave.length}\n${leave.join(' ')}\n`;
      if (guildMap.size) {
        response += `👍 **Members on Discord:** ${[...guildMap.entries()]
          .map(([ownerId, members]) => `\n**<@${ownerId}>:**\n  - ${members.map((m) => m.trim()).join('\n  - ')}`)
          .join('')}\n\n`;
      }
      if (unknown.length) response += `👎 **Members not on Discord:** ${unknown.length}\n${unknown.join(' ')}\n`;

      yield* Effect.tryPromise(() => message.reply(response));
    });

  const checkCommand = (message: Message<true>, args: string[]) =>
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
          const config = yield* configStore.get;
          if (config.ownerIds.includes(message.author.id)) {
            yield* checkUser(message, tag, page);
          }
        } else {
          yield* Effect.tryPromise(() => message.reply('Invalid player tag!'));
        }
      }
    });

  const linkedTag = (message: Message<true>, ownerId: string, player: Player) =>
    Effect.gen(function* () {
      const member = message.guild.members.cache.get(ownerId);
      if (!member) return;

      const config = yield* configStore.get;
      const rolesToRemove = message.guild.roles.cache.filter(isRegisterRole);
      yield* Effect.tryPromise(() => member.roles.remove(rolesToRemove));

      if (player.clan && config.clanTags.includes(player.clan.tag)) {
        const clanName = player.clan.name;
        const rolesToAdd = message.guild.roles.cache.filter((r) => r.name === clanName || r.name === 'Elder');
        yield* Effect.tryPromise(() => member.roles.add(rolesToAdd));
        const nickname = member.user.username.toLowerCase() === player.name.toLowerCase() ? `${player.name} ${player.tag}` : player.name;
        yield* Effect.tryPromise(() => member.setNickname(nickname));
      } else {
        const approvedRole = message.guild.roles.cache.find((r) => r.name === 'Approved');
        if (approvedRole) yield* Effect.tryPromise(() => member.roles.add(approvedRole));
        yield* Effect.tryPromise(() => member.setNickname(`TH ${player.townHallLevel} - ${player.name}`));
      }
    });

  const linkQueue = new Set<string>();

  const linkCommand = (message: Message<true>, args: string[]) =>
    Effect.gen(function* () {
      const tag = args[0];
      const mention = args[1];

      if (!tag || !Util.isValidTag(tag)) {
        yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nError, Player tag not valid!`));
        return;
      }

      if (linkQueue.has(message.author.id)) {
        yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nYou must complete previous operation before create new one.`));
        return;
      }
      linkQueue.add(message.author.id);

      yield* Effect.gen(function* () {
        const mentionId = mention?.match(UserOrMemberMentionRegex)?.[1] || (SnowflakeRegex.test(mention) ? mention : null);
        if (!mentionId) {
          yield* Effect.tryPromise(() => message.reply('Please mention a user to link.'));
          return;
        }

        const config = yield* configStore.get;
        const isAuthorized = config.ownerIds.includes(message.author.id) || message.member?.roles.cache.some(isModeratorRole);
        if (!isAuthorized) return;

        const player = yield* Effect.tryPromise(() => clash.getPlayer(tag));
        const embed = new EmbedBuilder().setColor('#0099ff').setFooter(parseClan(player));
        const thumbLeague = player.leagueTier ? player.leagueTier.icon.medium : emoji.thumbnail.replace('{0}', 'badges/noleague.png');
        embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague });
        embed.setThumbnail(emoji.thumbnail.replace('{0}', `townhalls/townhall-${player.townHallLevel}.png`));

        const titleField = `${formatPlayerStats(player)}\n`;

        const account = yield* AccountAdapter.findOne({ tag });
        if (account) {
          const user = yield* UserAdapter.findOne({ id: account.userId });
          const member = message.guild.members.cache.get(user?.ownerId || '');

          if (user && user.ownerId === mentionId) {
            yield* linkedTag(message, mentionId, player);
            embed.setDescription(`${titleField}Re-linked to **${member?.user.tag || mentionId}**.`);
          } else if (user) {
            yield* UserAdapter.update({ ...user, ownerId: mentionId });
            yield* linkedTag(message, mentionId, player);
            const newMember = message.guild.members.cache.get(mentionId);
            embed.setDescription(`${titleField}Owner changed to **${newMember?.user.tag || mentionId}**.`);
          }
          yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
          return;
        }

        embed.setDescription(`${titleField}Are you sure you want to link this account?`);
        const msg = yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
        yield* Effect.tryPromise(() => msg.react('✅'));
        yield* Effect.tryPromise(() => msg.react('❎'));

        const filter = (r: MessageReaction, u: DiscordUser) => ['✅', '❎'].includes(r.emoji.name!) && u.id === message.author.id;
        const collected = yield* Effect.tryPromise(() => msg.awaitReactions({ filter, max: 1, time: 60_000 })).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );

        yield* Effect.tryPromise(() => msg.reactions.removeAll());

        if (collected?.first()?.emoji.name === '✅') {
          const user = yield* UserAdapter.findOneAndUpdate({ ownerId: mentionId }, { ownerId: mentionId }, { upsert: true });
          yield* AccountAdapter.findOneAndUpdate({ tag }, { tag, userId: user!.id }, { upsert: true });
          yield* linkedTag(message, mentionId, player);
          const member = message.guild.members.cache.get(mentionId);
          embed.setDescription(`${titleField}Linked to **${member?.user.tag || mentionId}**.`);
        } else {
          const description = collected ? `${titleField}Operation canceled.` : `${titleField}No answer after 60 seconds, operation canceled.`;
          embed.setDescription(description);
        }

        yield* Effect.tryPromise(() => msg.edit({ embeds: [embed] }));
      }).pipe(Effect.ensuring(Effect.sync(() => linkQueue.delete(message.author.id))));
    });

  const commandMap: Record<string, (message: Message<true>, args: string[]) => Effect.Effect<void, any, SqliteDatabase | DiscordService>> = {
    ping: (message) => pingCommand(message),
    p: (message) => pingCommand(message),
    check: (message, args) => checkCommand(message, args),
    c: (message, args) => checkCommand(message, args),
    link: (message, args) => linkCommand(message, args),
    l: (message, args) => linkCommand(message, args),
  };

  const handleCommand = (message: Message<true>) =>
    Effect.gen(function* () {
      const config = yield* configStore.get;
      const prefix = config.prefix;

      if (!message.content.startsWith(prefix)) return;

      const parts = message.content.slice(prefix.length).trim().split(/\s+/);
      const commandName = parts.shift()?.toLowerCase();
      const args = parts;

      if (!commandName || !commandMap[commandName]) return;

      yield* commandMap[commandName](message, args).pipe(
        Effect.catchAll((error: any) =>
          Effect.gen(function* () {
            let field = `> ${message.content}\nUnhandled Rejection, please contact owner!`;

            const cause = error instanceof ClashApiError ? error.cause : error;

            if (cause instanceof HTTPError) {
              field = `> ${message.content}\n${cause.message}`;
              if (cause.reason === 'notFound' && cause.path.includes('/players/')) {
                field = `> ${message.content}\nError, Player tag not found!`;
              }
            } else if (error instanceof ClashApiError) {
              field = `> ${message.content}\n${error.message}`;
            } else if (error && typeof error === 'object' && 'message' in error) {
              field = `> ${message.content}\n${(error as any).message}`;
            } else {
              yield* Effect.logError(error);
            }
            yield* Effect.tryPromise(() => message.reply(field));
          }),
        ),
      );
    });

  return {
    handleCommand,
  };
});

export const CommandServiceLayer = Layer.effect(CommandServiceTag, CommandService);
