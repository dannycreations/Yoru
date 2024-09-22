import { Player } from 'clashofclans.js'
import { emoji } from '../contants/emoji'
import { MemberRoles } from '../contants/enum'

export function parseClan(player: Player, callback: (text: string, badge: string) => void) {
	let text = 'Player is clanless',
		badge = emoji.thumbnail.replace('{0}', 'noclan.png')

	if (player.clan) {
		// @ts-expect-error
		player.role = parseClanRole(player.role)
		text = `${player.role} of ${player.clan.name}\n(${player.clan.tag})`
		badge = player.clan.badge.url
	}

	callback(text, badge)
}

export function parseClanRole(role: Player['role']) {
	if (role === 'leader') return MemberRoles.Leader
	if (role === 'coLeader') return MemberRoles.CoLeader
	if (role === 'elder') return MemberRoles.Elder
	return MemberRoles.Member
}
