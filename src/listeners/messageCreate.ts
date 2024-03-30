import { Listener } from '@sapphire/framework'
import { Message } from 'discord.js'
import { config } from '../lib/shared/config'

export class UserListener extends Listener {
	public async run(message: Message) {
		if (message.webhookId !== null || message.system || message.author.bot) return

		this.container.logger.info(`${message.author.tag}: ${message.content}`)
		if (this.container.client.ownerOnly && !config.ownerId.includes(message.author.id)) {
			await message.channel.send('⚠️ Under Maintenance')
		}
	}
}
