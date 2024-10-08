import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities'
import { Args, Command, Result } from '@sapphire/framework'
import { free, send } from '@sapphire/plugin-editable-commands'
import { _ } from '@vegapunk/utilities'
import { Player, Util } from 'clashofclans.js'
import { EmbedBuilder, GuildMember, Message, MessageReaction, Role, User } from 'discord.js'
import { ClashAPI } from '../../lib/api/ClashAPI'
import { emoji } from '../../lib/contants/emoji'
import { Events, MemberRoles, RegisterRoles } from '../../lib/contants/enum'
import { DBAccount, DBUser } from '../../lib/database/LokiDB'
import { parseClan } from '../../lib/helpers/clan.helper'
import { isModeratorRole, isRegisterRole } from '../../lib/helpers/core.helper'

export class UserCommand extends Command {
	public constructor(context: Command.LoaderContext) {
		super(context, { aliases: ['l'] })
	}

	public override async messageRun(message: Message, args: Args) {
		if (!this.userPermissions(message)) return

		const { sessions } = this.container.client

		const result = await Result.fromAsync(async () => {
			const tag = await args.pick('string')

			if (Util.isValidTag(tag)) {
				if (this.queueProtect.includes(message.author.id)) {
					const field = `> ${message.content}\nYou must complete previous operation before create new one.`
					await send(message, field)
					return
				}
				this.queueProtect.push(message.author.id)

				const mention = await args.pick('string')
				const mentionId = mention.match(UserOrMemberMentionRegex)?.[1]
				if (mentionId) {
					await this.link(message, tag, mentionId)
				} else if (SnowflakeRegex.test(mention)) {
					if (!sessions.data.ownerIds.includes(message.author.id)) return
					await this.link(message, tag, mention)
				}
			} else {
				const field = `> ${message.content}\nError, Player tag not valid!`
				await send(message, field)
			}
		})
		result.inspectErr((error) => ClashAPI.Instance.emit(Events.apiError, message, error))

		free(message)
		_.pull(this.queueProtect, message.author.id)
	}

	private async link(message: Message, tag: string, user: string) {
		let thumbLeague: string

		const player = await ClashAPI.Instance.getPlayer(tag)
		if (player.league) thumbLeague = player.league.icon.medium
		else thumbLeague = emoji.thumbnail.replace('{0}', 'badges/noleague.png')

		const embed = new EmbedBuilder()
		embed.setColor('#0099ff')
		embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague })
		embed.setThumbnail(emoji.thumbnail.replace('{0}', `townhalls/townhall-${player.townHallLevel}.png`))
		const titleField = `${emoji.level} ${player.expLevel} ${emoji.trophies} ${player.trophies.toLocaleString()} ${
			emoji.attackwin
		} ${player.attackWins.toLocaleString()}\n`
		embed.setDescription(`${titleField}Are you sure want to link this account?`)
		parseClan(player, (text: string, iconURL: string) => embed.setFooter({ text, iconURL }))

		const dataAccount = DBAccount.findOne({ tag })
		const dataUser = DBUser.findOne({ $loki: dataAccount?.user_id })
		const member = message.guild.members.cache.get(dataAccount ? dataUser.owner_id : user)

		if (dataAccount) {
			if (member && user === dataUser.owner_id) {
				await this.linkedTag(message, member, player)

				embed.setDescription(`${titleField}Re-linked to **${member.user.tag}**.`)
			} else if (!member && user !== dataUser.owner_id) {
				dataUser.owner_id = user
				DBUser.updateOneAndSave(dataUser)

				const member = message.guild.members.cache.get(user)
				await this.linkedTag(message, member, player)

				embed.setDescription(`${titleField}Owner changed to **${member.user.tag}**.`)
			} else {
				embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`)
			}

			await send(message, { embeds: [embed] })
			return
		}

		const msg = await send(message, { embeds: [embed] })
		const confirmEmojis = Object.values<string>(ConfirmEmojis)
		await Promise.all(confirmEmojis.map((r) => msg.react(r)))

		const result = await Result.fromAsync(async () => {
			const filter = (r: MessageReaction, u: User) => confirmEmojis.includes(r.emoji.name) && u.id === message.author.id
			const reaction = (await msg.awaitReactions({ filter, max: 1, time: 60_000 })).first()
			await msg.reactions.removeAll()

			if (reaction.emoji.name === ConfirmEmojis.No) {
				embed.setDescription(`${titleField}Operation canceled.`)
				await msg.edit({ embeds: [embed] })
				return
			}

			let dataUser = DBUser.findOne({ owner_id: user })
			if (!dataUser) dataUser = DBUser.insertOneAndSave({ owner_id: user })

			if (DBAccount.findOne({ user_id: dataUser.$loki })) {
				if (member.roles.cache.some(isRegisterRole)) {
					await this.linkedTag(message, member, player)
				}
			} else {
				await this.linkedTag(message, member, player)
			}

			DBAccount.insertOneAndSave({ tag, user_id: dataUser.$loki, created_at: Date.now() })
			embed.setDescription(`${titleField}Linked to **${member.user.tag}**.`)
			await msg.edit({ embeds: [embed] })
		})
		result.inspectErr(async (error) => {
			if (typeof error === 'object' && 'message' in error) this.container.logger.info(error)

			await msg.reactions.removeAll()
			embed.setDescription(`${titleField}No answer after 60 seconds, operation canceled.`)
			await msg.edit({ embeds: [embed] })
		})
	}

	private async linkedTag(message: Message, member: GuildMember, player: Player) {
		const { sessions } = this.container.client

		const roles = message.guild.roles.cache.filter(isRegisterRole)
		await member.roles.remove(roles)

		if (player.clan && sessions.data.clanTags.includes(player.clan.tag)) {
			const _isMemberRole = (r: Role) => r.name === player.clan.name || r.name === MemberRoles.Elder
			const roles = message.guild.roles.cache.filter(_isMemberRole)
			await member.roles.remove(roles)

			let nickname = player.name
			if (member.user.username.toLowerCase() === player.name.toLowerCase()) {
				nickname = `${player.name} ${player.tag}`
			}

			await member.setNickname(nickname)
		} else {
			const _isRegisterRole = (r: Role) => r.name === RegisterRoles.Approved
			const role = message.guild.roles.cache.find(_isRegisterRole)
			await member.roles.add(role)

			await member.setNickname(`TH ${player.townHallLevel} - ${player.name}`)
		}
	}

	private userPermissions(message: Message) {
		const { sessions } = this.container.client

		if (sessions.data.ownerIds.includes(message.author.id)) return true
		else if (message.member.roles.cache.some(isModeratorRole)) return true
		return false
	}

	private queueProtect: string[] = []
}

enum ConfirmEmojis {
	Yes = '✅',
	No = '❎',
}
