import { ApplyOptions } from '@sapphire/decorators'
import { Command, CommandOptions } from '@sapphire/framework'
import { Message } from 'discord.js'

@ApplyOptions<CommandOptions>({ aliases: ['p'] })
export class UserCommand extends Command {
	public async messageRun(message: Message) {
		const msg = await message.reply({ content: 'ping?' })

		const content = `Pong! Bot Latency ${Math.round(this.container.client.ws.ping)}ms. API Latency ${
			msg.createdTimestamp - message.createdTimestamp
		}ms.`

		await msg.edit(content)
	}
}
