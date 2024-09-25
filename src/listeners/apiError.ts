import { Listener } from '@sapphire/framework'
import { send } from '@sapphire/plugin-editable-commands'
import { HTTPError } from 'clashofclans.js'
import { Message } from 'discord.js'
import { ClashAPI } from '../lib/api/ClashAPI'
import { Events } from '../lib/contants/enum'

export class UserListener extends Listener {
	public constructor(context: Listener.LoaderContext) {
		super(context, { emitter: ClashAPI.Instance, event: Events.apiError })
	}

	public async run(message: Message, error: unknown) {
		let field = `> ${message.content}\nUnhandled Rejection, please contact owner!`

		if (error instanceof HTTPError) {
			field = `> ${message.content}\n${error.message}`
			if (error.reason === 'notFound' && !!~error.path.indexOf('/players/')) {
				field = `> ${message.content}\nError, Player tag not found!`
			}
		} else {
			this.container.logger.error(error)
		}

		await send(message, field)
	}
}
