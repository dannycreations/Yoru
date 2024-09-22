import { Listener } from '@sapphire/framework'
import { Message } from 'discord.js'

export class UserListener extends Listener {
	public async run(message: Message) {
		if (message.webhookId !== null || message.system || message.author.bot) return

		const { sessions } = this.container.client

		this.container.logger.info(`${message.author.tag}: ${message.content}`)
		if (this.container.client.isMaintenance && !sessions.cache.ownerIds.includes(message.author.id)) {
			await message.channel.send('⚠️ Under Maintenance')
		}
	}
}
