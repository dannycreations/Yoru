import 'dotenv/config'
import './lib/database/loki'

import { LogLevel, Logger, container } from '@sapphire/framework'
import { XFarmerClient } from './lib/XFarmerClient'

async function bootstrap() {
	container.logger = new Logger(LogLevel.Debug)

	new XFarmerClient().login(process.env.DISCORD_TOKEN)
}
bootstrap()
