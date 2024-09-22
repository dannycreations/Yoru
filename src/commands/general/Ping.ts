import { Command } from '@sapphire/framework'
import { Message } from 'discord.js'

export class UserCommand extends Command {
	public constructor(context: Command.LoaderContext) {
		super(context, { aliases: ['p'] })
	}

	public override async messageRun(message: Message) {
		const msg = await message.reply('ping?')
		const content = `Pong! Bot Latency ${Math.round(this.container.client.ws.ping)}ms. API Latency ${
			msg.createdTimestamp - message.createdTimestamp
		}ms.`
		await msg.edit(content)
	}
}
