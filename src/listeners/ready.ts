import { ApplyOptions } from '@sapphire/decorators'
import { Listener, ListenerOptions } from '@sapphire/framework'
import { ActivityType } from 'discord.js'

@ApplyOptions<ListenerOptions>({ once: true })
export class UserListener extends Listener {
	public run() {
		clearTimeout(this.container.client.loginTimeout)

		this.container.client.user.setPresence({
			status: 'idle',
			activities: [
				{
					name: 'Clash of Clans',
					type: ActivityType.Playing,
				},
			],
		})

		const text = [
			'Bot has started,',
			`${this.container.client.users.cache.size} users,`,
			`${this.container.client.channels.cache.size} channels,`,
			`${this.container.client.guilds.cache.size} guilds.`,
		]
		this.container.logger.info(text.join(' '))
	}
}
