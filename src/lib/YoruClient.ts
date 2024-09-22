import { Logger, LogLevel, SapphireClient } from '@sapphire/framework'
import { logger } from '@vegapunk/logger'
import { _ } from '@vegapunk/utilities'
import { GatewayIntentBits, Partials } from 'discord.js'
import { join } from 'path'
import { ClashAPI } from './api/ClashAPI'
import { Events } from './contants/enum'
import { OfflineCache } from './core/OfflineCache'

export class YoruClient extends SapphireClient {
	public override sessions: OfflineCache<SessionContext>
	public override isMaintenance: boolean = false
	public override loginTimeout = setTimeout(() => process.exit(1), 60_000)

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
			partials: Object.keys(Partials).map((r) => Partials[r]),
			intents: Object.keys(GatewayIntentBits).map((r) => GatewayIntentBits[r]),
		})

		const _logger = logger({
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

		this.sessions = new OfflineCache<SessionContext>({
			file: join(process.cwd(), 'sessions', 'session.json'),
			interval: 10_000,
			init: {
				prefix: '?',
				ownerIds: [],
				clanTags: [],
				clans: [],
			},
		})
	}

	public async start() {
		await this.sessions.readCache()
		await this.pollingEvent()

		this.options.defaultPrefix = this.sessions.cache.prefix
		await super.login(process.env.DISCORD_TOKEN)
	}

	private async pollingEvent() {
		ClashAPI.Instance.addClans(this.sessions.cache.clanTags)
		ClashAPI.Instance.setClanEvent({
			name: Events.clanMember,
			filter: (oldClan, newClan) => {
				const oldMembers = oldClan.members
				const newMembers = newClan.members
				const diff = _.differenceBy(oldMembers, newMembers, 'tag')
				return diff.length !== 0
			},
		})

		await ClashAPI.Instance.init()
	}
}

declare module 'discord.js' {
	interface Client {
		readonly isMaintenance: boolean
		readonly sessions: OfflineCache<SessionContext>
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
