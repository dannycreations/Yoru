import { container } from '@sapphire/framework'
import { HTTPError } from 'clashofclans.js'
import { Message } from 'discord.js'

export function errorResponse(message: Message, error: unknown) {
	if (error instanceof HTTPError) {
		let field = `> ${message.content}\n${error.message}`
		if (error.reason === 'notFound' && !!~error.path.indexOf('/players/')) {
			field = `> ${message.content}\nError, Player tag not found!`
		}

		return message.channel.send(field)
	}

	container.logger.error(error)

	let field = `> ${message.content}\nUnhandled Rejection, please contact owner!`
	return message.channel.send(field)
}
