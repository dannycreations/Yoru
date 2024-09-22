import { Listener } from '@sapphire/framework'

export class UserListener extends Listener {
	public constructor(context: Listener.LoaderContext) {
		super(context, { emitter: process })
	}

	public run(error: Error) {
		if ('context' in error && typeof error.context === 'object') {
			const { context } = error as ErrorContext
			if (context.error.code === 'ENOTFOUND') return
		}
		this.container.logger.fatal(error, 'UncaughtException')
	}
}

interface ErrorContext extends Error {
	context: {
		error: {
			errno: number
			code: string
			syscall: string
			hostname: string
		}
	}
}
