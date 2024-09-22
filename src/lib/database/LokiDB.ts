import LokiConstructor from 'lokijs'
import { existsSync } from 'node:fs'
import { LokiAdapter } from './LokiAdapter'

export const loki = new LokiConstructor('sessions/database.db', {
	adapter: new LokiAdapter(process.env.LOKI_ENC_KEY),
	autosave: true,
	autosaveInterval: 1000,
})

if (existsSync(loki.filename)) loki.loadDatabase()

interface CustomCollection<T extends object> extends Collection<T> {
	insertOneAndSave(doc: T, callback?: (err?: any) => void): T & LokiObj
	updateOneAndSave(doc: T, callback?: (err?: any) => void): T & LokiObj
}

function model<T extends object>(dbName: string, options?: Partial<CollectionOptions<T>>): CustomCollection<T> {
	const collection = (loki.getCollection(dbName) ||
		loki.addCollection(dbName, {
			autoupdate: true,
			disableMeta: true,
			...options,
		})) as CustomCollection<T>

	collection.insertOneAndSave = function (doc, callback) {
		try {
			return this.insert(doc) as T & LokiObj
		} finally {
			loki.save(callback)
		}
	}

	collection.updateOneAndSave = function (doc, callback) {
		try {
			return this.update(doc) as T & LokiObj
		} finally {
			loki.save(callback)
		}
	}

	return collection
}

export interface UserSchema {
	owner_id: string
}

export interface AccountSchema {
	tag: string
	user_id: number
	created_at: number
	is_banned?: boolean
	banned_at?: number
}

export const DBUser = model<UserSchema>('user', { unique: ['owner_id'] })
export const DBAccount = model<AccountSchema>('account', { unique: ['tag'] })
