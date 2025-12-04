import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { Command } from '@sapphire/framework';
import { free, send } from '@sapphire/plugin-editable-commands';
import { isErrorLike, Result } from '@vegapunk/utilities/result';
import { waitForEach } from '@vegapunk/utilities/sleep';
import { dayjs } from '@vegapunk/utilities/time';
import { Util } from 'clashofclans.js';
import { EmbedBuilder } from 'discord.js';

import { ClashAPI } from '../../lib/api/ClashAPI';
import { emoji } from '../../lib/contants/emoji';
import { ClientEvents } from '../../lib/contants/enum';
import { DBAccount, DBUser } from '../../lib/database/drizzle';
import { accountTable, accountTableType, userTable } from '../../lib/database/schema';
import { parseClan } from '../../lib/helpers/clan.helper';
import { getGuild } from '../../lib/helpers/core.helper';

import type { Args } from '@sapphire/framework';
import type { Message } from 'discord.js';

export class UserCommand extends Command {
  public constructor(context: Command.LoaderContext) {
    super(context, { aliases: ['c'] });
  }

  public override async messageRun(message: Message<true>, args: Args): Promise<void> {
    const { config } = this.container.client;

    const result = await Result.fromAsync(async () => {
      const tag = await args.pick('string');
      const page = await args.pick('number').catch(() => 0);

      if (/member/i.test(tag)) {
        return this.checkMembers(message, page);
      }
      if (Util.isValidTag(tag)) {
        return this.checkPlayer(message, tag);
      }

      const mentionId = tag.match(UserOrMemberMentionRegex)?.[1];
      if (mentionId) {
        await this.checkUser(message, mentionId, page);
      } else if (SnowflakeRegex.test(tag)) {
        if (!config.data.ownerIds.includes(message.author.id)) {
          return;
        }
        await this.checkUser(message, tag, page);
      } else {
        const field = `> ${message.content}\nError, Player tag not valid!`;
        await send(message, field);
      }
    });
    result.inspectErr((error) => ClashAPI.Instance.emit(ClientEvents.ApiError, message, error));

    free(message);
  }

  private async checkUser(message: Message<true>, ownerId: string, page: number) {
    const getUser = DBUser.find({ ownerId }, { joins: [{ table: accountTable, on: { id: 'userId' } }] });
    Result.assert(getUser.isOk(), '', { ...getUser, ownerId });

    const dataAccount = getUser.unwrap().map((r) => r.account);
    if (!dataAccount.length) {
      const field = `> ${message.content}\nThere is no tag linked to this user!`;
      await send(message, field);
    } else if (page >= 1 && page <= dataAccount.length) {
      await this.checkPlayer(message, dataAccount[page - 1].tag);
    } else {
      await this.checkProfile(message, ownerId, dataAccount);
    }
  }

  private async checkProfile(message: Message<true>, ownerId: string, dataAccounts: accountTableType[]) {
    const member = message.guild.members.cache.get(ownerId);
    if (!member) {
      const field = `> ${message.content}\nUser leaving discord server!`;
      await send(message, field);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setDescription(`Joined ${dayjs.utc(member.joinedAt).fromNow()}`)
      .setThumbnail(member.user.displayAvatarURL());

    let count = 0;
    await waitForEach(dataAccounts, async (account) => {
      if (account.isBanned) {
        return;
      }

      try {
        let field = '';
        const player = await ClashAPI.Instance.getPlayer(account.tag);
        field += `${emoji.hashtag} ${player.tag}\n`;

        const level = `${emoji.level} ${player.expLevel}`;
        const trophies = `${emoji.trophies} ${player.trophies.toLocaleString()}`;
        const attacks = `${emoji.attackwin} ${player.attackWins.toLocaleString()}`;
        field += `${level} ${trophies} ${attacks}\n`;

        if (player.clan) {
          field += `${emoji.isclan.true} ${player.clan.name}`;
        } else {
          field += `${emoji.isclan.false} Player is clanless`;
        }

        embed.addFields({
          name: `${++count}. ${emoji.townhalls[player.townHallLevel - 1]} ${player.name}`,
          value: field,
        });
      } catch (error) {
        if (isErrorLike(error) && 'reason' in error) {
          if (error.reason === 'notFound') {
            account.isBanned = true;
            DBAccount.update(account);
          }
        }
      } finally {
        if (account.isBanned) {
          embed.addFields({
            name: `${++count}. ${emoji.townhalls[0]} ${account.tag}`,
            value: '⛔ Has been banned!',
          });
        }
      }
    });

    embed.setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() });
    embed.setTimestamp();
    await send(message, { embeds: [embed] });
  }

  private async checkPlayer(message: Message<true>, tag: string) {
    let thumbLeague: string;
    let isOwned = '';

    const player = await ClashAPI.Instance.getPlayer(tag);
    const embed = new EmbedBuilder();
    embed.setColor('#0099ff');
    embed.setTitle('Open in Clash of Clans ↗');
    embed.setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${tag}`);
    if (player.leagueTier) {
      thumbLeague = player.leagueTier.icon.medium;
    } else {
      thumbLeague = emoji.thumbnail.replace('{0}', 'badges/noleague.png');
    }
    embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague });
    embed.setThumbnail(emoji.thumbnail.replace('{0}', `townhalls/townhall-${player.townHallLevel}.png`));

    const getAccount = DBAccount.findOne({ tag }, { joins: [{ table: userTable, on: { userId: 'id' } }] });
    Result.assert(getAccount.isOk(), '', { ...getAccount, tag });

    const ownerId = getAccount.unwrap()?.user.ownerId;
    if (ownerId) {
      const member = message.guild.members.cache.get(ownerId);
      isOwned = `👤 ${member ? member.user.tag : ownerId}\n`;
    }

    const level = `${emoji.level} ${player.expLevel}`;
    const trophies = `${emoji.trophies} ${player.trophies.toLocaleString()}`;
    const attacks = `${emoji.attackwin} ${player.attackWins.toLocaleString()}`;
    embed.addFields({ name: 'Profiles', value: `${isOwned}${level} ${trophies} ${attacks}` });

    const troops: string[] = [];
    const darkTroops: string[] = [];
    const superTroops: string[] = [];
    const siegeTroops: string[] = [];
    const petTroops: string[] = [];
    const spells: string[] = [];
    const darkSpells: string[] = [];
    const heroes: string[] = [];
    const achievements: string[] = [];
    const unknowns: unknown[] = [];

    await waitForEach(
      player.troops.filter((r) => r.village === 'home'),
      (troop) => {
        const field = '**' + troop.level + '**/' + troop.maxLevel;
        if (Object.keys(emoji.troops.normal).includes(troop.name)) {
          troops.push(emoji.troops.normal[troop.name] + field);
        } else if (Object.keys(emoji.troops.dark).includes(troop.name)) {
          darkTroops.push(emoji.troops.dark[troop.name] + field);
        } else if (Object.keys(emoji.troops.super).includes(troop.name)) {
          superTroops.push(emoji.troops.super[troop.name] + field);
        } else if (Object.keys(emoji.troops.siege).includes(troop.name)) {
          siegeTroops.push(emoji.troops.siege[troop.name] + field);
        } else if (Object.keys(emoji.troops.pets).includes(troop.name)) {
          petTroops.push(emoji.troops.pets[troop.name] + field);
        } else {
          unknowns.push(troop);
        }
      },
    );

    if (troops.length) embed.addFields({ name: 'Troops', value: troops.join(' ') });
    if (darkTroops.length) embed.addFields({ name: 'Dark Troops', value: darkTroops.join(' ') });
    if (superTroops.length) embed.addFields({ name: 'Super Troops', value: superTroops.join(' ') });
    if (siegeTroops.length) embed.addFields({ name: 'Siege Machines', value: siegeTroops.join(' ') });
    if (petTroops.length) embed.addFields({ name: 'Pets', value: petTroops.join(' ') });

    await waitForEach(
      player.spells.filter((r) => r.village === 'home'),
      (spell) => {
        const field = '**' + spell.level + '**/' + spell.maxLevel;
        if (Object.keys(emoji.spells.normal).includes(spell.name)) {
          spells.push(emoji.spells.normal[spell.name] + field);
        } else if (Object.keys(emoji.spells.dark).includes(spell.name)) {
          darkSpells.push(emoji.spells.dark[spell.name] + field);
        } else {
          unknowns.push(spell);
        }
      },
    );

    if (spells.length) embed.addFields({ name: 'Spells', value: spells.join(' ') });
    if (darkSpells.length) embed.addFields({ name: 'Dark Spells', value: darkSpells.join(' ') });

    await waitForEach(
      player.heroes.filter((r) => r.village === 'home'),
      (hero) => {
        const field = '**' + hero.level + '**/' + hero.maxLevel;
        if (Object.keys(emoji.heroes).includes(hero.name)) {
          heroes.push(emoji.heroes[hero.name] + field);
        } else {
          unknowns.push(hero);
        }
      },
    );

    if (heroes.length) embed.addFields({ name: 'Heroes', value: heroes.join(' ') });

    const achievementsName = ['Friend in Need', 'Games Champion'];
    await waitForEach(
      player.achievements.filter((r) => achievementsName.includes(r.name)),
      (achievement) => {
        achievements.push(emoji.stars[achievement.stars] + ' **' + achievement.name + '** ' + achievement.value.toLocaleString() + '\n');
      },
    );

    if (achievements.length) embed.addFields({ name: 'Achievements', value: achievements.join('') });
    if (unknowns.length) this.container.logger.warn(unknowns);

    parseClan(player, (text, iconURL) => embed.setFooter({ text, iconURL }));
    await send(message, { embeds: [embed] });
  }

  private async checkMembers(message: Message<true>, page = 1) {
    const { config } = this.container.client;

    const userGuild = getGuild(message.author.id)!;
    await userGuild.members.fetch();

    if (page < 1 || page > config.data.clanTags.length) {
      page = 1;
    }

    let field = '';
    const leave: string[] = [];
    const unknown: string[] = [];

    const guildMap = new Map<string, string[]>();
    const clan = await ClashAPI.Instance.getClan(config.data.clanTags[page - 1]);
    await waitForEach(clan.members, async (member) => {
      const field = `**${member.name}** ${member.tag}\n`;

      const tag = member.tag;
      const getAccount = DBAccount.findOne({ tag }, { joins: [{ table: userTable, on: { userId: 'id' } }] });
      Result.assert(getAccount.isOk(), '', { ...getAccount, tag });

      const ownerId = getAccount.unwrap()?.user.ownerId;
      if (ownerId) {
        if (userGuild.members.cache.has(ownerId)) {
          if (!guildMap.has(ownerId)) {
            guildMap.set(ownerId, []);
          }
          guildMap.get(ownerId)!.push(field);
        } else {
          leave.push(field);
        }
      } else {
        unknown.push(field);
      }
    });

    field += `**### ${clan.name} (${clan.tag})**\n👥 **Total Members in Clan:** ${clan.memberCount}\n\n`;
    if (leave.length) {
      field += `🖕 **Members leave Discord:** ${leave.length}\n${leave.join(' ')}\n`;
    }
    if (guildMap.size) {
      field += `👍 **Members on Discord:** ${[...guildMap.entries()]
        .map(([ownerId, members]) => {
          const membersList = members.map((m) => m.trim()).join('\n  - ');
          return `\n**<@${ownerId}>:**\n  - ${membersList}`;
        })
        .join('')}\n\n`;
    }
    if (unknown.length) {
      field += `👎 **Members not on Discord:** ${unknown.length}\n${unknown.join(' ')}\n`;
    }

    await send(message, field);
  }
}
