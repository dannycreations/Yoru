import { LogLevel, Logger, SapphireClient } from '@sapphire/framework'
import { GatewayIntentBits, Partials } from 'discord.js'
import { config } from './shared/config'
import { logger } from './utils/logger.util'

export class XFarmerClient extends SapphireClient {
	public ownerOnly: boolean = false
	public pathLogs: string = `${process.cwd()}/logs`
	public loginTimeout = setTimeout(() => process.exit(1), 60_000)

	public constructor() {
		super({
			typing: true,
			shards: 'auto',
			disableMentionPrefix: true,
			defaultPrefix: config.prefix,
			caseInsensitiveCommands: true,
			caseInsensitivePrefixes: true,
			loadDefaultErrorListeners: false,
			loadMessageCommandListeners: true,
			logger: new Logger(LogLevel.Debug),
			partials: Object.keys(Partials).map((r) => Partials[r]),
			intents: Object.keys(GatewayIntentBits).map((r) => GatewayIntentBits[r]),
		})

		// @ts-expect-error
		const _logger = logger(this.logger.level)
		this.logger.trace = _logger.trace.bind(_logger)
		this.logger.debug = _logger.debug.bind(_logger)
		this.logger.info = _logger.info.bind(_logger)
		this.logger.warn = _logger.warn.bind(_logger)
		this.logger.error = _logger.error.bind(_logger)
		this.logger.fatal = _logger.fatal.bind(_logger)
	}
}

declare module 'discord.js' {
	interface Client {
		readonly pathLogs: string
		readonly ownerOnly: boolean
		readonly loginTimeout: NodeJS.Timeout
	}
}
