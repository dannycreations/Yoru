import LokiConstructor from 'lokijs'
import { existsSync } from 'node:fs'
import { Adapter } from './adapter'

export const loki = new LokiConstructor('database.db', {
	adapter: new Adapter(process.env.ENC_KEY),
	autosave: true,
	autosaveInterval: 500,
})

if (existsSync(loki.filename)) loki.loadDatabase()

interface Collection2<E extends object> extends Collection<E> {
	insertAndSave(doc: E | E[]): E & LokiObj
	updateAndSave(doc: E | E[]): E & LokiObj
}

function model<T extends object>(dbName: string, options?: Partial<CollectionOptions<T>>): Collection2<T> {
	const collection = (loki.getCollection(dbName) ||
		loki.addCollection(dbName, {
			autoupdate: true,
			disableMeta: true,
			...options,
		})) as Collection2<T>

	collection.insertAndSave = function (doc) {
		const result = this.insert(doc)
		loki.save()
		return result
	}

	collection.updateAndSave = function (doc) {
		const result = this.update(doc)
		loki.save()
		return result
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
}

export const DBUser = model<UserSchema>('user', { unique: ['owner_id'] })
export const DBAccount = model<AccountSchema>('account', { unique: ['tag'] })
