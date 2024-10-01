import { Logger, LogLevel, SapphireClient } from '@sapphire/framework'
import { logger } from '@vegapunk/logger'
import { GatewayIntentBits, Partials } from 'discord.js'
import { join } from 'path'
import { ClashAPI } from './api/ClashAPI'
import { Events } from './contants/enum'
import { OfflineStore } from './stores/OfflineStore'

export class YoruClient extends SapphireClient {
	public override isMaintenance: boolean = false
	public override sessions: OfflineStore<SessionContext>
	public override loginTimeout = setTimeout(() => process.exit(1), 60_000).unref()

	public constructor() {
		super({
			typing: true,
			shards: 'auto',
			disableMentionPrefix: true,
			caseInsensitiveCommands: true,
			caseInsensitivePrefixes: true,
			loadDefaultErrorListeners: false,
			loadMessageCommandListeners: true,
			logger: new Logger(LogLevel.Debug),
			partials: [...Object.values(Partials)] as Partials[],
			intents: [...Object.values(GatewayIntentBits)] as GatewayIntentBits[],
		})

		const _logger = logger({
			// @ts-expect-error
			level: this.logger['level'],
			exceptionHandler: false,
			rejectionHandler: false,
		})
		this.logger.trace = _logger.trace.bind(_logger)
		this.logger.debug = _logger.debug.bind(_logger)
		this.logger.info = _logger.info.bind(_logger)
		this.logger.warn = _logger.warn.bind(_logger)
		this.logger.error = _logger.error.bind(_logger)
		this.logger.fatal = _logger.fatal.bind(_logger)

		this.sessions = new OfflineStore<SessionContext>({
			path: join(process.cwd(), 'sessions', 'session.json'),
			init: {
				prefix: '?',
				ownerIds: [],
				clanTags: [],
				clans: [],
			},
		})
	}

	public async start() {
		await this.sessions.readFile()
		await this.pollingEvent()

		this.options.defaultPrefix = this.sessions.data.prefix
		await super.login(process.env.DISCORD_TOKEN)
	}

	private async pollingEvent() {
		ClashAPI.Instance.addClans(this.sessions.data.clanTags)
		ClashAPI.Instance.setClanEvent({ name: Events.clanMember, filter: () => true })

		await ClashAPI.Instance.init()
	}
}

declare module 'discord.js' {
	interface Client {
		readonly isMaintenance: boolean
		readonly sessions: OfflineStore<SessionContext>
		readonly sessionsDir: string
		loginTimeout: NodeJS.Timeout
	}
}

export interface SessionContext {
	prefix: string
	ownerIds: string[]
	clanTags: string[]
	clans: Array<{ name: string; tag: string }>
}
