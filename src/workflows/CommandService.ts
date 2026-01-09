import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { HTTPError, Util } from 'clashofclans.js';
import { EmbedBuilder } from 'discord.js';
import { Context, Effect, Layer, Option } from 'effect';

import { emoji } from '../core/emojis';
import { parseClan } from '../helpers/clash.helper';
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

export const CommandService = Effect.gen(function* (_) {
  const { client: discord } = yield* _(DiscordClientTag);
  const { client: clash } = yield* _(ClashClientTag);
  const configStore = yield* _(ConfigStore);
  const handleCommand = (message: Message<true>) =>
    Effect.gen(function* (_) {
      const config = yield* _(configStore.get);
      const prefix = config.prefix;

      if (!message.content.startsWith(prefix)) return;

      const parts = message.content.slice(prefix.length).trim().split(/\s+/);
      const commandName = parts.shift()?.toLowerCase();
      const args = parts;

      if (!commandName) return;

      // Dispatching commands
      yield* _(
        Effect.gen(function* (_) {
          switch (commandName) {
            case 'ping':
            case 'p':
              yield* _(pingCommand(message));
              break;
            case 'check':
            case 'c':
              yield* _(checkCommand(message, args));
              break;
            case 'link':
            case 'l':
              yield* _(linkCommand(message, args));
              break;
            default:
              // Unknown command, ignore or log
              break;
          }
        }).pipe(
          Effect.catchAll((error: any) =>
            Effect.gen(function* (_) {
              let field = `> ${message.content}\nUnhandled Rejection, please contact owner!`;

              // Unwrap ClashApiError to check for HTTPError
              const cause = error instanceof ClashApiError ? error.cause : error;

              if (cause instanceof HTTPError) {
                field = `> ${message.content}\n${cause.message}`;
                if (cause.reason === 'notFound' && cause.path.includes('/players/')) {
                  field = `> ${message.content}\nError, Player tag not found!`;
                }
              } else if (error instanceof ClashApiError) {
                field = `> ${message.content}\n${error.message}`;
              } else if (error && typeof error === 'object' && 'message' in error) {
                // Handle generic errors with message property
                field = `> ${message.content}\n${(error as any).message}`;
              } else {
                yield* _(Effect.logError(error));
              }
              yield* _(Effect.tryPromise(() => message.reply(field)));
            }),
          ),
        ),
      );
    });

  const pingCommand = (message: Message<true>) =>
    Effect.gen(function* (_) {
      const msg = yield* _(Effect.tryPromise(() => message.reply('ping?')));
      const botLatency = Math.round(discord.ws.ping);
      const apiLatency = msg.createdTimestamp - message.createdTimestamp;
      yield* _(Effect.tryPromise(() => msg.edit(`Pong! BOT Latency ${botLatency}ms. API Latency ${apiLatency}ms.`)));
    });

  const checkCommand = (message: Message<true>, args: string[]) =>
    Effect.gen(function* (_) {
      const tag = args[0];
      const page = parseInt(args[1] || '0', 10);

      if (!tag) {
        yield* _(Effect.tryPromise(() => message.reply('Please provide a player tag or mention a user.')));
        return;
      }

      if (/member/i.test(tag)) {
        yield* _(checkMembers(message, page));
      } else if (Util.isValidTag(tag)) {
        yield* _(checkPlayer(message, tag));
      } else {
        const mentionId = tag.match(UserOrMemberMentionRegex)?.[1];
        if (mentionId) {
          yield* _(checkUser(message, mentionId, page));
        } else if (SnowflakeRegex.test(tag)) {
          const config = yield* _(configStore.get);
          if (config.ownerIds.includes(message.author.id)) {
            yield* _(checkUser(message, tag, page));
          }
        } else {
          yield* _(Effect.tryPromise(() => message.reply('Invalid player tag!')));
        }
      }
    });

  const checkUser = (message: Message<true>, ownerId: string, page: number) =>
    Effect.gen(function* (_) {
      const user = yield* _(UserAdapter.findOne({ ownerId }));
      if (!user) {
        yield* _(Effect.tryPromise(() => message.reply(`> ${message.content}\nThere is no tag linked to this user!`)));
        return;
      }

      const accounts = yield* _(AccountAdapter.find({ userId: user.id }));
      if (!accounts.length) {
        yield* _(Effect.tryPromise(() => message.reply(`> ${message.content}\nThere is no tag linked to this user!`)));
      } else if (page >= 1 && page <= accounts.length) {
        yield* _(checkPlayer(message, accounts[page - 1].tag));
      } else {
        yield* _(checkProfile(message, ownerId, accounts));
      }
    });

  const checkProfile = (message: Message<true>, ownerId: string, accounts: any[]) =>
    Effect.gen(function* (_) {
      const member = message.guild.members.cache.get(ownerId);
      if (!member) {
        yield* _(Effect.tryPromise(() => message.reply(`> ${message.content}\nUser leaving discord server!`)));
        return;
      }

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
        // Meticulously adding the "Joined ... ago" description to match legacy parity
        .setDescription(`Joined <t:${Math.floor(member.joinedTimestamp! / 1000)}:R>`)
        .setThumbnail(member.user.displayAvatarURL());

      let count = 0;
      for (const account of accounts) {
        if (account.bannedAt) continue;

        try {
          let field = '';
          const player = yield* _(Effect.tryPromise(() => clash.getPlayer(account.tag)));
          field += `${emoji.hashtag} ${player.tag}\n`;

          const level = `${emoji.level} ${player.expLevel}`;
          const trophies = `${emoji.trophies} ${player.trophies.toLocaleString()}`;
          const attacks = `${emoji.attackwin} ${player.attackWins.toLocaleString()}`;
          field += `${level} ${trophies} ${attacks}\n`;

          field += player.clan ? `${emoji.isclan.true} ${player.clan.name}` : `${emoji.isclan.false} Player is clanless`;

          embed.addFields({
            name: `${++count}. ${emoji.townhalls[player.townHallLevel - 1]} ${player.name}`,
            value: field,
          });
        } catch (error) {
          // Handle 404/Not Found by marking as banned, similar to legacy logic
          // Meticulously check for 404 status to ensure we only mark as banned when appropriate
          if (error && typeof error === 'object' && 'reason' in error && error.reason === 'notFound') {
            yield* _(AccountAdapter.update({ ...account, bannedAt: Date.now() }));
          }
        } finally {
          // Showing banned accounts in the profile list
          if (account.bannedAt) {
            embed.addFields({
              name: `${++count}. ${emoji.townhalls[0]} ${account.tag}`,
              value: '⛔ Has been banned!',
            });
          }
        }
      }

      embed.setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() }).setTimestamp();
      yield* _(Effect.tryPromise(() => message.reply({ embeds: [embed] })));
    });

  const checkPlayer = (message: Message<true>, tag: string) =>
    Effect.gen(function* (_) {
      const player = yield* _(Effect.tryPromise(() => clash.getPlayer(tag)));
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Open in Clash of Clans ↗')
        .setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${tag}`);

      const thumbLeague = player.leagueTier ? player.leagueTier.icon.medium : emoji.thumbnail.replace('{0}', 'badges/noleague.png');
      embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague });
      embed.setThumbnail(emoji.thumbnail.replace('{0}', `townhalls/townhall-${player.townHallLevel}.png`));

      const account = yield* _(AccountAdapter.findOne({ tag }));
      let isOwned = '';
      if (account) {
        const user = yield* _(UserAdapter.findOne({ id: account.userId }));
        if (user) {
          const member = message.guild.members.cache.get(user.ownerId);
          isOwned = `👤 ${member ? member.user.tag : user.ownerId}\n`;
        }
      }

      embed.addFields({
        name: 'Profiles',
        value: `${isOwned}${emoji.level} ${player.expLevel} ${emoji.trophies} ${player.trophies.toLocaleString()} ${emoji.attackwin} ${player.attackWins.toLocaleString()}`,
      });

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

      player.troops
        .filter((r) => r.village === 'home')
        .forEach((troop) => {
          const field = `**${troop.level}**/${troop.maxLevel}`;
          if (emoji.troops.normal[troop.name]) categories['Troops'].push(emoji.troops.normal[troop.name] + field);
          else if (emoji.troops.dark[troop.name]) categories['Dark Troops'].push(emoji.troops.dark[troop.name] + field);
          else if (emoji.troops.super[troop.name]) categories['Super Troops'].push(emoji.troops.super[troop.name] + field);
          else if (emoji.troops.siege[troop.name]) categories['Siege Machines'].push(emoji.troops.siege[troop.name] + field);
          else if (emoji.troops.pets[troop.name]) categories['Pets'].push(emoji.troops.pets[troop.name] + field);
        });

      player.spells
        .filter((r) => r.village === 'home')
        .forEach((spell) => {
          const field = `**${spell.level}**/${spell.maxLevel}`;
          if (emoji.spells.normal[spell.name]) categories['Spells'].push(emoji.spells.normal[spell.name] + field);
          else if (emoji.spells.dark[spell.name]) categories['Dark Spells'].push(emoji.spells.dark[spell.name] + field);
        });

      player.heroes
        .filter((r) => r.village === 'home')
        .forEach((hero) => {
          if (emoji.heroes[hero.name]) categories['Heroes'].push(emoji.heroes[hero.name] + `**${hero.level}**/${hero.maxLevel}`);
        });

      Object.entries(categories).forEach(([name, list]) => {
        if (list.length) embed.addFields({ name, value: list.join(' ') });
      });

      // Implement achievements display to match legacy check command parity
      const achievements: string[] = [];
      const achievementsName = ['Friend in Need', 'Games Champion'];
      player.achievements
        .filter((r) => achievementsName.includes(r.name))
        .forEach((achievement) => {
          achievements.push(emoji.stars[achievement.stars] + ' **' + achievement.name + '** ' + achievement.value.toLocaleString() + '\n');
        });

      if (achievements.length) embed.addFields({ name: 'Achievements', value: achievements.join('') });

      // Warn about unknown troops/spells/heroes in logs
      const unknowns: any[] = [];
      player.troops
        .filter((r) => r.village === 'home')
        .forEach((troop) => {
          if (
            !emoji.troops.normal[troop.name] &&
            !emoji.troops.dark[troop.name] &&
            !emoji.troops.super[troop.name] &&
            !emoji.troops.siege[troop.name] &&
            !emoji.troops.pets[troop.name]
          ) {
            unknowns.push(troop);
          }
        });
      player.spells
        .filter((r) => r.village === 'home')
        .forEach((spell) => {
          if (!emoji.spells.normal[spell.name] && !emoji.spells.dark[spell.name]) {
            unknowns.push(spell);
          }
        });
      player.heroes
        .filter((r) => r.village === 'home')
        .forEach((hero) => {
          if (!emoji.heroes[hero.name]) {
            unknowns.push(hero);
          }
        });
      if (unknowns.length) yield* _(Effect.logWarning('Unknown assets detected:', unknowns));

      embed.setFooter(parseClan(player));
      yield* _(Effect.tryPromise(() => message.reply({ embeds: [embed] })));
    });

  const checkMembers = (message: Message<true>, page = 1) =>
    Effect.gen(function* (_) {
      const config = yield* _(configStore.get);
      const clanTags = config.clanTags;
      if (page < 1 || page > clanTags.length) page = 1;

      const clan = yield* _(Effect.tryPromise(() => clash.getClan(clanTags[page - 1])));
      const guildMap = new Map<string, string[]>();
      const leave: string[] = [];
      const unknown: string[] = [];

      for (const member of clan.members) {
        const field = `**${member.name}** ${member.tag}\n`;
        const account = yield* _(AccountAdapter.findOne({ tag: member.tag }));
        const userId = account?.userId;

        if (userId) {
          const user = yield* _(UserAdapter.findOne({ id: userId }));
          if (user) {
            // Meticulously check if member is still in the guild using the helper
            const memberOpt = yield* _(getGuildMember(user.ownerId));
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

      yield* _(Effect.tryPromise(() => message.reply(response)));
    });

  // QueueProtect to prevent overlapping link operations for the same user
  const linkQueue = new Set<string>();

  const linkCommand = (message: Message<true>, args: string[]) =>
    Effect.gen(function* (_) {
      const tag = args[0];
      const mention = args[1];

      if (!tag || !Util.isValidTag(tag)) {
        yield* _(Effect.tryPromise(() => message.reply(`> ${message.content}\nError, Player tag not valid!`)));
        return;
      }

      if (linkQueue.has(message.author.id)) {
        yield* _(Effect.tryPromise(() => message.reply(`> ${message.content}\nYou must complete previous operation before create new one.`)));
        return;
      }
      linkQueue.add(message.author.id);

      // Ensure cleanup in case of errors
      yield* _(
        Effect.gen(function* (_) {
          const mentionId = mention?.match(UserOrMemberMentionRegex)?.[1] || (SnowflakeRegex.test(mention) ? mention : null);
          if (!mentionId) {
            yield* _(Effect.tryPromise(() => message.reply('Please mention a user to link.')));
            return;
          }

          // Permission check
          const config = yield* _(configStore.get);
          const isAuthorized = config.ownerIds.includes(message.author.id) || message.member?.roles.cache.some(isModeratorRole);
          if (!isAuthorized) return;

          const player = yield* _(Effect.tryPromise(() => clash.getPlayer(tag)));
          const embed = new EmbedBuilder().setColor('#0099ff').setFooter(parseClan(player));
          const thumbLeague = player.leagueTier ? player.leagueTier.icon.medium : emoji.thumbnail.replace('{0}', 'badges/noleague.png');
          embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague });
          embed.setThumbnail(emoji.thumbnail.replace('{0}', `townhalls/townhall-${player.townHallLevel}.png`));

          const titleField = `${emoji.level} ${player.expLevel} ${emoji.trophies} ${player.trophies.toLocaleString()} ${emoji.attackwin} ${player.attackWins.toLocaleString()}\n`;

          const account = yield* _(AccountAdapter.findOne({ tag }));
          if (account) {
            const user = yield* _(UserAdapter.findOne({ id: account.userId }));
            const member = message.guild.members.cache.get(user?.ownerId || '');

            if (user && user.ownerId === mentionId) {
              yield* _(linkedTag(message, mentionId, player));
              embed.setDescription(`${titleField}Re-linked to **${member?.user.tag || mentionId}**.`);
            } else if (user) {
              yield* _(UserAdapter.update({ ...user, ownerId: mentionId }));
              yield* _(linkedTag(message, mentionId, player));
              const newMember = message.guild.members.cache.get(mentionId);
              embed.setDescription(`${titleField}Owner changed to **${newMember?.user.tag || mentionId}**.`);
            }
            yield* _(Effect.tryPromise(() => message.reply({ embeds: [embed] })));
            return;
          }

          embed.setDescription(`${titleField}Are you sure you want to link this account?`);
          const msg = yield* _(Effect.tryPromise(() => message.reply({ embeds: [embed] })));
          yield* _(Effect.tryPromise(() => msg.react('✅')));
          yield* _(Effect.tryPromise(() => msg.react('❎')));

          const filter = (r: MessageReaction, u: DiscordUser) => ['✅', '❎'].includes(r.emoji.name!) && u.id === message.author.id;
          const collected = yield* _(
            Effect.tryPromise(() => msg.awaitReactions({ filter, max: 1, time: 60_000 })),
            Effect.catchAll(() => Effect.succeed(null)),
          );

          yield* _(Effect.tryPromise(() => msg.reactions.removeAll()));

          if (collected?.first()?.emoji.name === '✅') {
            const user = yield* _(UserAdapter.findOneAndUpdate({ ownerId: mentionId }, { ownerId: mentionId }, { upsert: true }));
            yield* _(AccountAdapter.findOneAndUpdate({ tag }, { tag, userId: user!.id }, { upsert: true }));
            yield* _(linkedTag(message, mentionId, player));
            const member = message.guild.members.cache.get(mentionId);
            embed.setDescription(`${titleField}Linked to **${member?.user.tag || mentionId}**.`);
          } else {
            const description = collected ? `${titleField}Operation canceled.` : `${titleField}No answer after 60 seconds, operation canceled.`;
            embed.setDescription(description);
          }

          yield* _(Effect.tryPromise(() => msg.edit({ embeds: [embed] })));
        }).pipe(Effect.ensuring(Effect.sync(() => linkQueue.delete(message.author.id)))),
      );
    });

  const linkedTag = (message: Message<true>, ownerId: string, player: Player) =>
    Effect.gen(function* (_) {
      const member = message.guild.members.cache.get(ownerId);
      if (!member) return;

      const config = yield* _(configStore.get);
      const rolesToRemove = message.guild.roles.cache.filter(isRegisterRole);
      yield* _(Effect.tryPromise(() => member.roles.remove(rolesToRemove)));

      if (player.clan && config.clanTags.includes(player.clan.tag)) {
        const clanName = player.clan.name;
        const rolesToAdd = message.guild.roles.cache.filter((r) => r.name === clanName || r.name === 'Elder');
        yield* _(Effect.tryPromise(() => member.roles.add(rolesToAdd)));
        const nickname = member.user.username.toLowerCase() === player.name.toLowerCase() ? `${player.name} ${player.tag}` : player.name;
        yield* _(Effect.tryPromise(() => member.setNickname(nickname)));
      } else {
        const approvedRole = message.guild.roles.cache.find((r) => r.name === 'Approved');
        if (approvedRole) yield* _(Effect.tryPromise(() => member.roles.add(approvedRole)));
        yield* _(Effect.tryPromise(() => member.setNickname(`TH ${player.townHallLevel} - ${player.name}`)));
      }
    });

  return {
    handleCommand,
  };
});

export interface CommandService {
  readonly handleCommand: (message: Message<true>) => Effect.Effect<void, any, SqliteDatabase | DiscordService>;
}

export const CommandServiceTag = Context.GenericTag<CommandService>('@services/CommandService');

export const CommandServiceLayer = Layer.effect(CommandServiceTag, CommandService);
