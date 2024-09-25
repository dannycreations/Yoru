import { Listener } from '@sapphire/framework'
import { send } from '@sapphire/plugin-editable-commands'
import { Message } from 'discord.js'

export class UserListener extends Listener {
	public async run(message: Message) {
		if (message.webhookId !== null || message.system || message.author.bot) return

		const { sessions } = this.container.client

		this.container.logger.info(`${message.author.tag}: ${message.content}`)
		if (this.container.client.isMaintenance && !sessions.data.ownerIds.includes(message.author.id)) {
			await send(message, '⚠️ Under Maintenance')
		}
	}
}
