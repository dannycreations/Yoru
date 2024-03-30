import { Player } from 'clashofclans.js'
import { config } from '../shared/config'

export function parseClan(player: Player, cb: (text: string, badge: string) => void) {
	if (player.clan) {
		// @ts-expect-error
		player.role = parseClanRole(player.role)
		cb(`${player.role} of ${player.clan.name}\n(${player.clan.tag})`, player.clan.badge.url)
	} else {
		cb('Player is clanless', config.emojis.thumbnail.replace('{0}', 'noclan.png'))
	}
}

export function parseClanRole(role: Player['role']) {
	if (role === 'leader') return 'Leader'
	if (role === 'coLeader') return 'Co-Leader'
	if (role === 'elder') return 'Elder'
	return 'Member'
}
