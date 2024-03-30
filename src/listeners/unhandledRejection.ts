import { ApplyOptions } from '@sapphire/decorators'
import { Listener, ListenerOptions } from '@sapphire/framework'

@ApplyOptions<ListenerOptions>({ emitter: process })
export class UserListener extends Listener {
	public run(message: Error) {
		this.container.logger.fatal(message)
	}
}
