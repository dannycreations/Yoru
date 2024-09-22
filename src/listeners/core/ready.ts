import { Listener } from '@sapphire/framework'
import { ActivityType } from 'discord.js'

export class UserListener extends Listener {
	public run() {
		if (typeof this.container.client.loginTimeout !== 'undefined') {
			clearTimeout(this.container.client.loginTimeout)
			this.container.client.loginTimeout = undefined

			const text = [
				'Bot has started,',
				`${this.container.client.users.cache.size} users,`,
				`${this.container.client.channels.cache.size} channels,`,
				`${this.container.client.guilds.cache.size} guilds.`,
			]
			this.container.logger.info(text.join(' '))
		}

		this.container.client.user.setPresence({
			status: 'idle',
			activities: [
				{
					name: 'Clash of Clans',
					type: ActivityType.Playing,
				},
			],
		})
	}
}
