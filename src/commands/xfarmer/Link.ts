import { ApplyOptions } from '@sapphire/decorators'
import { Args, Command, CommandOptions, Result } from '@sapphire/framework'
import { EmbedBuilder, GuildMember, Message, MessageReaction, Role, User } from 'discord.js'
import { pull } from 'lodash'
import { ClashAPI } from '../../lib/api/ClashAPI'
import { DBAccount, DBUser } from '../../lib/database/loki'
import { parseClan } from '../../lib/helpers/clan.helper'
import { errorResponse } from '../../lib/helpers/error.helper'
import { isValidTag } from '../../lib/helpers/player.helper'
import { config } from '../../lib/shared/config'

@ApplyOptions<CommandOptions>({ aliases: ['l'] })
export class UserCommand extends Command {
	public async messageRun(message: Message, args: Args) {
		if (!this.userPermissions(message)) return

		const result = await Result.fromAsync(async () => {
			const tag = await args.pick('string')

			if (isValidTag(tag)) {
				if (this.queueProtect.includes(message.author.id)) {
					const field = `> ${message.content}\nYou must complete previous operation before create new one.`
					return message.channel.send(field)
				}
				this.queueProtect.push(message.author.id)

				const mention = await args.pick('string')
				const mMatch = mention.match(/^<@!?(\d+)>$/)
				if (mMatch?.length) {
					await this.link(message, tag, mMatch[1])
				} else {
					if (config.ownerId.includes(message.author.id)) {
						await this.link(message, tag, mention)
					}
				}
			} else {
				const field = `> ${message.content}\nError, Player tag not valid!`
				await message.channel.send(field)
			}
		})
		result.inspectErr((error) => errorResponse(message, error))

		pull(this.queueProtect, message.author.id)
	}

	private async link(message: Message, tag: string, user: string) {
		let thumbLeague: string

		const player = await ClashAPI.Instance.getPlayer(tag)
		if (player.league) thumbLeague = player.league.icon.medium
		else thumbLeague = config.emojis.thumbnail.replace('{0}', 'noleague.png')

		const embed = new EmbedBuilder()
		embed.setColor('#0099ff')
		embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague })
		embed.setThumbnail(config.emojis.thumbnail.replace('{0}', `townhall-${player.townHallLevel}.png`))
		const titleField = `${config.emojis.level} ${player.expLevel} ${config.emojis.trophies} ${player.trophies.toLocaleString()} ${
			config.emojis.attackwin
		} ${player.attackWins.toLocaleString()}\n`
		embed.setDescription(`${titleField}Are you sure want to link this account?`)
		parseClan(player, (text: string, iconURL: string) => embed.setFooter({ text, iconURL }))

		const dataAccount = DBAccount.findOne({ tag })
		const dataUser = DBUser.findOne({ $loki: dataAccount?.user_id })
		const member = message.guild.members.cache.get(dataAccount ? dataUser.owner_id : user)
		const regRoles = (r: Role) => ['Entry', 'Pending', 'Reapply', 'Approved'].includes(r.name)

		if (dataAccount) {
			const linkedTag = async (member: GuildMember) => {
				const roles = message.guild.roles.cache.filter(regRoles)
				if (roles.size) await member.roles.remove(roles)

				let role = message.guild.roles.cache.find((r) => r.name === player.clan.name)
				if (role) await member.roles.add(role)

				role = message.guild.roles.cache.find((r) => r.name === 'Elders')
				if (role) await member.roles.add(role)

				if (member.user.username.toLowerCase() === player.name.toLowerCase()) {
					await member.setNickname(`${player.name} ${player.tag}`)
				} else {
					await member.setNickname(player.name)
				}
			}

			if (member && user === dataUser.owner_id) {
				await linkedTag(member)

				embed.setDescription(`${titleField}Re-linked to **${member.user.tag}**.`)
			} else if (!member && user !== dataUser.owner_id) {
				dataUser.owner_id = user
				DBUser.updateAndSave(dataUser)

				const member = message.guild.members.cache.get(user)
				await linkedTag(member)

				embed.setDescription(`${titleField}Owner changed to **${member.user.tag}**.`)
			} else {
				embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`)
			}
			return message.channel.send({ embeds: [embed] })
		}

		const msg = await message.channel.send({ embeds: [embed] })
		await Promise.all([msg.react('✅'), msg.react('❎')])

		const result = await Result.fromAsync(async () => {
			const filter = (r: MessageReaction, u: User) => ['✅', '❎'].includes(r.emoji.name) && u.id === message.author.id
			const reaction = (await msg.awaitReactions({ filter, max: 1, time: 60_000 })).first()
			await msg.reactions.removeAll()

			if (reaction.emoji.name == '❎') {
				embed.setDescription(`${titleField}Operation canceled.`)
				return msg.edit({ embeds: [embed] })
			}

			let dataUser = DBUser.findOne({ owner_id: user })
			if (!dataUser) dataUser = DBUser.insertAndSave({ owner_id: user })

			const roles = message.guild.roles.cache.filter(regRoles)
			if (roles.size) await member.roles.remove(roles)

			if (!DBAccount.findOne({ user_id: dataUser.$loki })) {
				if (player.clan && config.clanTag.includes(player.clan.tag)) {
					let role = message.guild.roles.cache.find((r) => r.name === player.clan.name)
					if (role) await member.roles.add(role)

					role = message.guild.roles.cache.find((r) => r.name === 'Elders')
					if (role) await member.roles.add(role)

					if (member.user.username.toLowerCase() == player.name.toLowerCase()) {
						await member.setNickname(`${player.name} ${player.tag}`)
					} else {
						await member.setNickname(player.name)
					}
				} else {
					const role = message.guild.roles.cache.find((r) => r.name === 'Approved')
					if (role) await member.roles.add(role)

					await member.setNickname(`TH ${player.townHallLevel} - ${player.name}`)
				}
			}

			DBAccount.insertAndSave({ tag, user_id: dataUser.$loki, created_at: +new Date() })
			embed.setDescription(`${titleField}Linked to **${member.user.tag}**.`)
			await msg.edit({ embeds: [embed] })
		})
		result.inspectErr(async (error: Error) => {
			if (error?.message) this.container.logger.info(error)

			await msg.reactions.removeAll()
			embed.setDescription(`${titleField}No answer after 60 seconds, operation canceled.`)
			await msg.edit({ embeds: [embed] })
		})
	}

	private userPermissions(message: Message) {
		if (config.ownerId.includes(message.author.id)) return true
		if (message.member.roles.cache.some((r) => r.name === 'Manager')) return true
		return false
	}

	private queueProtect: string[] = []
}
