import { Listener } from '@sapphire/framework'
import { _ } from '@vegapunk/utilities'
import { Clan, ClanMember, HTTPError, Player } from 'clashofclans.js'
import { Role } from 'discord.js'
import { join } from 'node:path'
import { ClashAPI } from '../lib/api/ClashAPI'
import { Events, RegisterRoles } from '../lib/contants/enum'
import { OfflineCache } from '../lib/core/OfflineCache'
import { DBAccount, DBUser } from '../lib/database/LokiDB'
import { isClanRole, isModeratorRole } from '../lib/helpers/core.helper'

export class UserListener extends Listener {
	public constructor(context: Listener.LoaderContext) {
		super(context, { emitter: ClashAPI.Instance, event: Events.clanMember })
	}

	public async run(oldClan: Clan, newClan: Clan) {
		const { sessions } = this.container.client

		let clan = this.clan.get(oldClan.tag)
		if (!clan) {
			const cache = new OfflineCache<Clan>({
				file: join(this.container.client.sessions.dir, 'clan', `${oldClan.tag}.json`),
				interval: 60 * 1000,
				init: oldClan,
			})
			await cache.readCache()

			this.clan.set(oldClan.tag, cache)
			clan = this.clan.get(oldClan.tag)
		}

		if (typeof clan.cache !== 'undefined') {
			oldClan = clan.cache
			clan.clearCache()
		}

		await clan.writeCache(oldClan)

		if (sessions.cache.clans.some((r) => r.tag !== oldClan.tag)) {
			sessions.cache.clans.push({ name: oldClan.name, tag: oldClan.tag })
		}

		for (const player of oldClan.members) {
			if (newClan.members.some((member) => member.tag === player.tag)) continue
			this.queueLeaving.push(player)
		}

		if (!this.lockLeavingClan && this.queueLeaving.length) {
			this.lockLeavingClan = true
			await this.leavingClan()
			this.lockLeavingClan = false
		}
	}

	private lockLeavingClan: boolean
	private async leavingClan() {
		const { sessions } = this.container.client

		for (const player of this.queueLeaving) {
			if (this.queueProtect.has(player.tag)) continue

			this.container.logger.info(`${player.tag}: Player left the clan`)
			let dataAccount = DBAccount.find({ tag: player.tag })
			if (!dataAccount.length) continue
			this.queueProtect.add(player.tag)

			const user_id = dataAccount[0].user_id
			if (this.queueProtect.has(user_id)) continue
			this.queueProtect.add(user_id)

			let playerAccount: Player = null

			dataAccount = DBAccount.find({ user_id })
			for (const account of dataAccount) {
				if (account.is_banned) continue
				if (account.tag === player.tag) continue

				try {
					const playerData = await ClashAPI.Instance.getPlayer(account.tag)
					if (playerData.clan && sessions.cache.clanTags.includes(playerData.clan.tag)) {
						playerAccount = playerData
						break
					}
				} catch (error) {
					if (error instanceof HTTPError && error.reason === 'notFound') {
						account.is_banned = true
						account.banned_at = Date.now()
						DBAccount.updateOneAndSave(account)
					}
				}
			}

			const dataUser = DBUser.findOne({ $loki: user_id })
			for (const [id, guild] of this.container.client.guilds.cache) {
				const member = guild.members.cache.get(dataUser.owner_id)
				if (!member || member.roles.cache.some(isModeratorRole)) continue

				this.container.logger.info(`${player.tag}: Found member at ${guild.name} (${id})`)
				if (playerAccount) {
					let nickname = playerAccount.name
					if (member.user.username.toLowerCase() === playerAccount.name.toLowerCase()) {
						nickname = `${playerAccount.name} ${playerAccount.tag}`
					}

					await member.setNickname(nickname)
					this.container.logger.info(`${player.tag}: Change nickname ${member.user.username} to ${nickname}`)
				} else {
					const isMemberRole = (r: Role) => isMemberRole(r) || isClanRole(r)
					const roles = guild.roles.cache.filter(isMemberRole)
					await member.roles.remove(roles)

					const isRegisterRole = (r: Role) => r.name === RegisterRoles.Reapply
					const role = guild.roles.cache.find(isRegisterRole)
					await member.roles.add(role)

					this.container.logger.info(`${player.tag}: Register role ${RegisterRoles.Reapply}`)
				}
			}

			this.queueProtect.delete(player.tag)
			this.queueProtect.delete(user_id)
			_.pull(this.queueLeaving, player)
		}
	}

	private queueLeaving: ClanMember[] = []
	private queueProtect = new Set<string | number>()

	private clan = new Map<string, OfflineCache<Clan>>()
}
