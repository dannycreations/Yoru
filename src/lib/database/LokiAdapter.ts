import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'

export class LokiAdapter {
	public constructor(private secret: string) {
		if (!secret) throw new Error('A "secret" is required to decrypt')
	}

	public loadDatabase(dbName: string, callback: (v?: any) => void) {
		try {
			const encrypted = readFileSync(dbName)
			callback(this.decrypt(encrypted).toString())
		} catch (error) {
			if (error.code === 'ENOENT') {
				callback(null)
			}

			callback(error)
		}
	}

	public saveDatabase(dbName: string, dbData: string, callback: (v?: any) => void) {
		const encrypted = this.encrypt(dbData)
		writeFileSync(dbName, encrypted, 'binary')
		callback()
	}

	public deleteDatabase(dbName: string, callback: (v?: any) => void) {
		try {
			unlinkSync(dbName)
		} finally {
			callback()
		}
	}

	private encrypt(input: string) {
		if (!input) throw new Error('You must provide a value to decrypt')

		try {
			const salt = randomBytes(this.KEYLEN),
				iv = randomBytes(16)
			const key = pbkdf2Sync(this.secret, salt, this.ITERATIONS, this.KEYLEN, 'sha1'),
				cipher = createCipheriv(this.CIPHER, key, iv)

			let encrypted = cipher.update(input)
			encrypted = Buffer.concat([encrypted, cipher.final()])
			return Buffer.concat([salt, iv, encrypted])
		} catch (error) {
			error['message'] = `Unable to encrypt value due to: ${error['message']}`
			throw error
		}
	}

	private decrypt(input: Buffer) {
		if (!input) throw new Error('You must provide a value to decrypt')

		try {
			const salt = input.subarray(0, this.KEYLEN),
				iv = input.subarray(this.KEYLEN, 48)
			const key = pbkdf2Sync(this.secret, salt, this.ITERATIONS, this.KEYLEN, 'sha1'),
				decipher = createDecipheriv(this.CIPHER, key, iv)

			let decrypted = decipher.update(input.subarray(48))
			decrypted = Buffer.concat([decrypted, decipher.final()])
			return decrypted
		} catch (error) {
			error['message'] = `Unable to decrypt value due to: ${error['message']}`
			throw error
		}
	}

	private CIPHER = 'aes-256-cbc'
	private KEYLEN = 256 / 8
	private ITERATIONS = 64_000
}
