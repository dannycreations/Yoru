import { parseJsonc } from '@vegapunk/utilities'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export class OfflineCache<T extends Object> {
	public readonly dir: string
	public readonly cache: T

	constructor(private options: OffliceCacheOptions<T>) {
		this.dir = dirname(options.file)
		this.file = options.file
	}

	public clearCache() {
		Object.assign(this, { cache: undefined })
		return this
	}

	public async readCache() {
		await this.init()

		const readData = await readFile(this.file, 'utf8')
		const json = parseJsonc<T>(readData)
		this.lastWrite = json['lastWrite'] || 0
		Object.assign(this, { cache: json })
		return this
	}

	public async writeCache(json: T) {
		await this.init()

		if (this.lastWrite + this.interval > Date.now()) return this

		json['lastWrite'] = Date.now()
		await writeFile(this.file, JSON.stringify(json))
		this.lastWrite = json['lastWrite']
		Object.assign(this, { cache: json })
		return this
	}

	private async init() {
		if (this.lockInit) return
		this.lockInit = true

		this.options.init = { lastWrite: 0, ...this.options.init }
		await access(this.dir).catch(() => mkdir(this.dir, { recursive: true }))
		await access(this.file).catch(() => writeFile(this.file, JSON.stringify(this.options.init)))
		this.options.init = undefined
	}

	private file: string
	private interval: number
	private lockInit: boolean
	private lastWrite: number = 0
}

export interface OffliceCacheOptions<T> {
	file: string
	interval: number
	init?: T
}
