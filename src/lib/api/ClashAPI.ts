import { container } from '@sapphire/framework'
import { IPv4Regex } from '@vegapunk/utilities'
import { HTTPError, PollingClient, RequestOptions, Result } from 'clashofclans.js'
import { YoruClient } from '../YoruClient'

export class ClashAPI extends PollingClient {
	public static readonly Instance = new ClashAPI()

	public constructor() {
		super()
		Object.assign(this, { _pollingInterval: 60_000 })

		this.getIpOrig = this.rest.requestHandler['getIp'].bind(this.rest.requestHandler)
		this.rest.requestHandler['getIp'] = (token: string) => {
			const _ipFromError = this.ipFromError
			if (_ipFromError) {
				this.ipFromError = null
				return _ipFromError
			}

			return this.getIpOrig(token)
		}

		this.requestOrig = this.rest.requestHandler.request.bind(this.rest.requestHandler)
		this.rest.requestHandler.request = async <T>(path: string, options: RequestOptions = {}) => {
			try {
				const res = await this.requestOrig<T>(path, options)
				this.requestState = 0
				return res
			} catch (error) {
				if (this.requestState > 2) {
					this.requestState = 2
					error.message = 'There is a problem with the API, please check back later!'
					throw error
				}

				error.stack = null
				error.message = `${ClashAPI.name}: ${error.message}`
				container.logger.warn(error)

				if (error instanceof HTTPError) {
					if (error.status === 403) {
						if (error.reason === 'accessDenied.invalidIp') {
							this.rest.requestHandler['keys'].shift()
							this.ipFromError = error.message.match(IPv4Regex)[0]
						}

						await this.rest.login({
							email: process.env.CLASH_EMAIL,
							password: process.env.CLASH_PASSWORD,
							keyName: YoruClient.name,
							keyCount: 1,
						})

						this.requestState++
						return this.rest.requestHandler.request(path, options)
					}
				}

				throw error
			}
		}
	}

	private ipFromError?: string
	private requestState: number = 0
	private readonly getIpOrig: (token: string) => Promise<string | null>
	private readonly requestOrig: <T>(path: string, options?: RequestOptions) => Promise<Result<T>>
}
