import { ApplyOptions } from '@sapphire/decorators'
import { Args, Command, CommandOptions, Result } from '@sapphire/framework'
import { HTTPError } from 'clashofclans.js'
import { EmbedBuilder, Message } from 'discord.js'
import moment from 'moment-timezone'
import { ClashAPI } from '../../lib/api/ClashAPI'
import { AccountSchema, DBAccount, DBUser } from '../../lib/database/loki'
import { parseClan } from '../../lib/helpers/clan.helper'
import { errorResponse } from '../../lib/helpers/error.helper'
import { isValidTag } from '../../lib/helpers/player.helper'
import { config } from '../../lib/shared/config'

@ApplyOptions<CommandOptions>({ aliases: ['c'] })
export class UserCommand extends Command {
	public async messageRun(message: Message, args: Args) {
		const result = await Result.fromAsync(async () => {
			const tag = await args.pick('string')
			const page = await args.pick('number').catch(() => 0)

			if (/member/i.test(tag)) return this.checkMembers(message, page)
			if (isValidTag(tag)) return this.checkPlayer(message, tag)

			const hasLinkedTag = async (owner_id: string) => {
				const dataUser = DBUser.findOne({ owner_id })
				const dataAccount = DBAccount.find({ user_id: dataUser?.$loki })
				if (!dataAccount.length) {
					const field = `> ${message.content}\nThere is no tag linked to this user!`
					await message.channel.send(field)
				} else if (page >= 1 && page <= dataAccount.length) {
					await this.checkPlayer(message, dataAccount[page - 1].tag)
				} else {
					await this.checkProfile(message, dataAccount)
				}
			}

			const mention = tag.match(/^<@!?(\d+)>$/)
			if (mention?.length) {
				await hasLinkedTag(mention[1])
			} else if (/^\d+$/.test(tag)) {
				if (!config.ownerId.includes(message.author.id)) return
				await hasLinkedTag(tag)
			} else {
				const field = `> ${message.content}\nError, Player tag not valid!`
				await message.channel.send(field)
			}
		})
		result.inspectErr((error) => errorResponse(message, error))
	}

	private async checkProfile(message: Message, dataAccount: AccountSchema[]) {
		const dataUser = DBUser.findOne({ $loki: dataAccount.at(0).user_id })
		const member = message.guild.members.cache.get(dataUser.owner_id)
		if (!member) {
			const field = `> ${message.content}\nUser leaving discord server!`
			return message.channel.send(field)
		}

		let count = 1
		const embed = new EmbedBuilder()
			.setColor('#0099ff')
			.setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
			.setDescription(`Joined ${moment.utc(member.joinedAt).fromNow()}`)
			.setThumbnail(member.user.displayAvatarURL())

		for (const account of dataAccount) {
			let field = ''

			try {
				const player = await ClashAPI.Instance.getPlayer(account.tag)
				field += `${config.emojis.hashtag} ${player.tag}\n`

				const level = `${config.emojis.level} ${player.expLevel}`
				const trophies = `${config.emojis.trophies} ${player.trophies.toLocaleString()}`
				const attacks = `${config.emojis.attackwin} ${player.attackWins.toLocaleString()}`
				field += `${level} ${trophies} ${attacks}\n`

				if (player.clan) field += `${config.emojis.isclan.true} ${player.clan.name}`
				else field += `${config.emojis.isclan.false} Player is clanless`

				embed.addFields({
					name: `${count++}. ${config.emojis.townhalls[player.townHallLevel - 1]} ${player.name}`,
					value: field,
				})
			} catch (error) {
				if (error instanceof HTTPError) {
					if (error.reason === 'notFound') {
						embed.addFields({
							name: `${count++}. ${config.emojis.townhalls[0]} ${account.tag}`,
							value: '⛔ Has been banned!',
						})
					}
				}
			}
		}

		embed.setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() })
		embed.setTimestamp()
		await message.channel.send({ embeds: [embed] })
	}

	private async checkPlayer(message: Message, tag: string) {
		let thumbLeague: string,
			isOwned = ''

		const player = await ClashAPI.Instance.getPlayer(tag)
		const embed = new EmbedBuilder()
		embed.setColor('#0099ff')
		embed.setTitle('Open in Clash of Clans ↗')
		embed.setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${tag}`)
		if (player.league) thumbLeague = player.league.icon.medium
		else thumbLeague = config.emojis.thumbnail.replace('{0}', 'noleague.png')
		embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague })
		embed.setThumbnail(config.emojis.thumbnail.replace('{0}', `townhall-${player.townHallLevel}.png`))

		const dataAccount = DBAccount.findOne({ tag })
		if (dataAccount) {
			const dataUser = DBUser.findOne({ $loki: dataAccount.user_id })
			const member = message.guild.members.cache.get(dataUser.owner_id)
			isOwned = `👤 ${member ? member.user.tag : dataUser.owner_id}\n`
		}

		const level = `${config.emojis.level} ${player.expLevel}`
		const trophies = `${config.emojis.trophies} ${player.trophies.toLocaleString()}`
		const attacks = `${config.emojis.attackwin} ${player.attackWins.toLocaleString()}`
		embed.addFields({ name: 'Profiles', value: `${isOwned}${level} ${trophies} ${attacks}` })

		const troops = [],
			darkTroops = [],
			superTroops = [],
			siegeTroops = [],
			petTroops = [],
			spells = [],
			darkSpells = [],
			heroes = [],
			achievements = [],
			unknowns = []

		for (const troop of player.troops.filter((r) => r.village === 'home')) {
			const troopNormal = config.emojis.troops.normal
			const troopDark = config.emojis.troops.dark
			const troopSuper = config.emojis.troops.super
			const troopSiege = config.emojis.troops.siege
			const troopPet = config.emojis.troops.pets
			const field = '**' + troop.level + '**/' + troop.maxLevel
			if (Object.keys(troopNormal).includes(troop.name)) {
				troops.push(troopNormal[troop.name] + field)
			} else if (Object.keys(troopDark).includes(troop.name)) {
				darkTroops.push(troopDark[troop.name] + field)
			} else if (Object.keys(troopSuper).includes(troop.name)) {
				superTroops.push(troopSuper[troop.name] + field)
			} else if (Object.keys(troopSiege).includes(troop.name)) {
				siegeTroops.push(troopSiege[troop.name] + field)
			} else if (Object.keys(troopPet).includes(troop.name)) {
				petTroops.push(troopPet[troop.name] + field)
			} else {
				unknowns.push(troop)
			}
		}

		if (troops.length) embed.addFields({ name: 'Troops', value: troops.join(' ') })
		if (darkTroops.length) embed.addFields({ name: 'Dark Troops', value: darkTroops.join(' ') })
		if (superTroops.length) embed.addFields({ name: 'Super Troops', value: superTroops.join(' ') })
		if (siegeTroops.length) embed.addFields({ name: 'Siege Machines', value: siegeTroops.join(' ') })
		if (petTroops.length) embed.addFields({ name: 'Pets', value: petTroops.join(' ') })

		for (const spell of player.spells.filter((r) => r.village === 'home')) {
			const spellNormal = config.emojis.spells.normal
			const spellDark = config.emojis.spells.dark
			const field = '**' + spell.level + '**/' + spell.maxLevel
			if (Object.keys(spellNormal).includes(spell.name)) {
				spells.push(spellNormal[spell.name] + field)
			} else if (Object.keys(spellDark).includes(spell.name)) {
				darkSpells.push(spellDark[spell.name] + field)
			} else {
				unknowns.push(spell)
			}
		}

		if (spells.length) embed.addFields({ name: 'Spells', value: spells.join(' ') })
		if (darkSpells.length) embed.addFields({ name: 'Dark Spells', value: darkSpells.join(' ') })

		for (const hero of player.heroes.filter((r) => r.village === 'home')) {
			const heroNormal = config.emojis.heroes
			const field = '**' + hero.level + '**/' + hero.maxLevel
			if (Object.keys(heroNormal).includes(hero.name)) {
				heroes.push(heroNormal[hero.name] + field)
			} else {
				unknowns.push(hero)
			}
		}

		if (heroes.length) embed.addFields({ name: 'Heroes', value: heroes.join(' ') })

		const achievementsName = ['Friend in Need', 'Games Champion']
		for (const achievement of player.achievements.filter((r) => achievementsName.includes(r.name))) {
			achievements.push(config.emojis.stars[achievement.stars] + ' **' + achievement.name + '** ' + achievement.value.toLocaleString() + '\n')
		}

		if (achievements.length) embed.addFields({ name: 'Achievements', value: achievements.join('') })
		if (unknowns.length) this.container.logger.warn(unknowns)

		parseClan(player, (text: string, iconURL: string) => embed.setFooter({ text, iconURL }))
		await message.channel.send({ embeds: [embed] })
	}

	private async checkMembers(message: Message, page: number = 1) {
		if (page < 1 || page > config.clanTag.length) page = 1

		let field = '',
			leaveCount = 0,
			leaveStr = '',
			inCount = 0,
			inStr = '',
			notInCount = 0,
			notInStr = ''

		const clan = await ClashAPI.Instance.getClan(config.clanTag[page - 1])
		for (const member of clan.members) {
			const field = `**${member.name}** ${member.tag}\n`
			const dataAccount = DBAccount.findOne({ tag: member.tag })
			if (dataAccount) {
				const dataUser = DBUser.findOne({ $loki: dataAccount.user_id })
				const member = message.guild.members.cache.get(dataUser.owner_id)
				if (!member) leaveCount++, (leaveStr += field)
				else inCount++, (inStr += field)
			} else notInCount++, (notInStr += field)
		}

		field += `**# ${clan.name} (${clan.tag})**\n👥 **Total Members in Clan:** ${clan.memberCount}\n\n`
		if (leaveStr) field += `🖕 **Members Leave Discord:** ${leaveCount}\n${leaveStr}\n`
		if (inStr) field += `👍 **Members in Discord:** ${inCount}\n${inStr}\n`
		if (notInStr) field += `👎 **Members not in Discord:** ${notInCount}\n${notInStr}\n`

		await message.channel.send(field)
	}
}
