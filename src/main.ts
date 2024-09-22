import 'dotenv/config'
import './lib/database/LokiDB'

import { container } from '@sapphire/framework'
import { YoruClient } from './lib/YoruClient'

const client = new YoruClient()

async function main() {
	try {
		await client.start()
	} catch (error) {
		container.logger.error(error)
		await client.destroy()
		process.exit(1)
	}
}
main().catch(container.logger.error.bind(container.logger))
