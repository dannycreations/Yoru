import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { Args, Command } from '@sapphire/framework';
import { free, send } from '@sapphire/plugin-editable-commands';
import { isErrorLike, Result } from '@vegapunk/utilities/result';
import { Player, Util } from 'clashofclans.js';
import { EmbedBuilder, GuildMember, Message, MessageReaction, Role, User } from 'discord.js';

import { ClashAPI } from '../../lib/api/ClashAPI';
import { Emoji } from '../../lib/contants/emoji';
import { ClientEvents, MemberRoles, RegisterRoles } from '../../lib/contants/enum';
import { DBAccount, DBUser } from '../../lib/database/drizzle';
import { userTable } from '../../lib/database/schema';
import { parseClan } from '../../lib/helpers/clan.helper';
import { isModeratorRole, isRegisterRole } from '../../lib/helpers/core.helper';

export class UserCommand extends Command {
  public constructor(context: Command.LoaderContext) {
    super(context, { aliases: ['l'] });
  }

  public override async messageRun(message: Message<true>, args: Args): Promise<void> {
    if (!this.hasPermissions(message)) return;

    const { config } = this.container.client;

    const result = await Result.fromAsync(async () => {
      const tag = await args.pick('string');

      if (Util.isValidTag(tag)) {
        if (this.queueProtect.has(message.author.id)) {
          const field = `> ${message.content}\nYou must complete previous operation before create new one.`;
          await send(message, field);
          return;
        }
        this.queueProtect.add(message.author.id);

        const mention = await args.pick('string');
        const mentionId = mention.match(UserOrMemberMentionRegex)?.[1];
        if (mentionId) {
          await this.link(message, tag, mentionId);
        } else if (SnowflakeRegex.test(mention)) {
          if (!config.data.ownerIds.includes(message.author.id)) return;
          await this.link(message, tag, mention);
        }
      } else {
        const field = `> ${message.content}\nError, Player tag not valid!`;
        await send(message, field);
      }
    });
    result.inspectErr((error) => ClashAPI.Instance.emit(ClientEvents.ApiError, message, error));

    free(message);
    this.queueProtect.delete(message.author.id);
  }

  private async link(message: Message<true>, tag: string, user: string) {
    let thumbLeague: string;

    const player = await ClashAPI.Instance.getPlayer(tag);
    if (player.league) thumbLeague = player.league.icon.medium;
    else thumbLeague = Emoji.thumbnail.replace('{0}', 'badges/noleague.png');

    const embed = new EmbedBuilder();
    embed.setColor('#0099ff');
    embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague });
    embed.setThumbnail(Emoji.thumbnail.replace('{0}', `townhalls/townhall-${player.townHallLevel}.png`));
    const titleField = `${Emoji.level} ${player.expLevel} ${Emoji.trophies} ${player.trophies.toLocaleString()} ${
      Emoji.attackwin
    } ${player.attackWins.toLocaleString()}\n`;
    embed.setDescription(`${titleField}Are you sure want to link this account?`);
    parseClan(player, (text, iconURL) => embed.setFooter({ text, iconURL }));

    const getAccount = DBAccount.findOne({ tag }, { joins: [{ table: userTable, on: { userId: 'id' } }] });
    Result.assert(getAccount.isOk(), '', { ...getAccount, tag });

    const dataUser = getAccount.unwrap();
    const member = message.guild.members.cache.get(dataUser ? dataUser.user.ownerId : user)!;

    if (dataUser) {
      if (member && user === dataUser.user.ownerId) {
        await this.linkedTag(message, member, player);

        embed.setDescription(`${titleField}Re-linked to **${member.user.tag}**.`);
      } else if (!member && user !== dataUser.user.ownerId) {
        dataUser.user.ownerId = user;
        DBUser.update(dataUser.user);

        const member = message.guild.members.cache.get(user)!;
        await this.linkedTag(message, member, player);

        embed.setDescription(`${titleField}Owner changed to **${member.user.tag}**.`);
      } else {
        embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`);
      }

      await send(message, { embeds: [embed] });
      return;
    }

    const msg = await send(message, { embeds: [embed] });
    const confirmEmojis = Object.values<string>(ConfirmEmojis);
    await Promise.all(confirmEmojis.map((r) => msg.react(r)));

    const result = await Result.fromAsync(async () => {
      const filter = (r: MessageReaction, u: User) => confirmEmojis.includes(r.emoji.name!) && u.id === message.author.id;
      const reaction = (await msg.awaitReactions({ filter, max: 1, time: 60_000 })).first()!;
      await msg.reactions.removeAll();

      if (reaction.emoji.name === ConfirmEmojis.No) {
        embed.setDescription(`${titleField}Operation canceled.`);
        await msg.edit({ embeds: [embed] });
        return;
      }

      const getUser = DBUser.findOneAndUpdate({ ownerId: user }, { ownerId: user }, { upsert: true });
      Result.assert(getUser.isOk(), '', getUser);

      const userId = getUser.unwrap()!.id;
      if (DBAccount.count({ userId })) {
        if (member.roles.cache.some(isRegisterRole)) {
          await this.linkedTag(message, member, player);
        }
      } else {
        await this.linkedTag(message, member, player);
      }

      const getAccount = DBAccount.findOneAndUpdate({ tag }, { tag, userId }, { upsert: true });
      Result.assert(getAccount.isOk(), '', getAccount);

      embed.setDescription(`${titleField}Linked to **${member.user.tag}**.`);
      await msg.edit({ embeds: [embed] });
    });
    result.inspectErr(async (error) => {
      if (isErrorLike(error)) this.container.logger.error(error);

      await msg.reactions.removeAll();
      embed.setDescription(`${titleField}No answer after 60 seconds, operation canceled.`);
      await msg.edit({ embeds: [embed] });
    });
  }

  private async linkedTag(message: Message<true>, member: GuildMember, player: Player) {
    const { config } = this.container.client;

    const roles = message.guild.roles.cache.filter(isRegisterRole);
    await member.roles.remove(roles);

    if (player.clan && config.data.clanTags.includes(player.clan.tag)) {
      const clanName = player.clan.name;
      const memberRole = (r: Role) => r.name === clanName || r.name === MemberRoles.Elder;
      await member.roles.add(message.guild.roles.cache.filter(memberRole));

      let nickname = player.name;
      if (member.user.username.toLowerCase() === player.name.toLowerCase()) {
        nickname = `${player.name} ${player.tag}`;
      }

      await member.setNickname(nickname);
    } else {
      const registerRole = (r: Role) => r.name === RegisterRoles.Approved;
      await member.roles.add(message.guild.roles.cache.filter(registerRole));

      await member.setNickname(`TH ${player.townHallLevel} - ${player.name}`);
    }
  }

  private hasPermissions(message: Message<true>) {
    Result.assert(message.member, '');

    const { config } = this.container.client;

    if (config.data.ownerIds.includes(message.author.id)) return true;
    else if (message.member!.roles.cache.some(isModeratorRole)) return true;
    return false;
  }

  private readonly queueProtect = new Set<string>();
}

enum ConfirmEmojis {
  Yes = '✅',
  No = '❎',
}
