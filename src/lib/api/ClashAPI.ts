import { container } from '@sapphire/framework'
import { Client, HTTPError, RequestOptions, Result } from 'clashofclans.js'

const IP_REGEX = /\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}/g

export class ClashAPI extends Client {
	public static readonly Instance = new ClashAPI()

	/**
	 * !TODO: this is realy bad solution
	 * ! but this solve the problem
	 * ! so i'm good for now :)
	 */
	public constructor() {
		super()

		// @ts-expect-error
		this.getIpOrig = this.rest.requestHandler.getIp.bind(this.rest.requestHandler)
		// @ts-expect-error
		this.rest.requestHandler.getIp = (token: string) => {
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
				container.logger.warn(error, `${ClashAPI.name} ${error.message}`)

				if (error instanceof HTTPError) {
					if (error.status === 403) {
						if (error.reason === 'accessDenied.invalidIp') {
							// @ts-expect-error
							this.rest.requestHandler.keys.shift()

							const getIp = error.message.match(IP_REGEX)[0]
							if (getIp) this.ipFromError = getIp
						}

						await this.rest.login({
							email: process.env.CLASH_EMAIL as string,
							password: process.env.CLASH_PASSWORD as string,
							keyName: 'X-Farmer 2',
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
