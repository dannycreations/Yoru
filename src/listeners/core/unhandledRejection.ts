import { Listener } from '@sapphire/framework'

export class UserListener extends Listener {
	public constructor(context: Listener.LoaderContext) {
		super(context, { emitter: process })
	}

	public run(error: Error) {
		this.container.logger.fatal(error, 'UnhandledRejection')
	}
}
