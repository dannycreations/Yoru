import { resolve } from 'node:path';
import { Config, Context, Effect, Layer } from 'effect';

import { Adapter, makeSqliteConfig, SqliteClientTag, SqliteConfigTag } from '../structures/database/index.js';
import { accountTable, userTable } from './schema.js';

const isDrizzleKit = process.argv.toString().includes('drizzle-kit');
const projectDir = resolve(import.meta.dirname, '..', '..');

const out = './migrations';
const schema = './src/database/schema.ts';

export const SqliteConfigLayer = Layer.effect(
  SqliteConfigTag,
  Effect.gen(function* () {
    const url = yield* Config.string('SQLITE_URL').pipe(Config.withDefault('sessions/sqlite.db'));
    return makeSqliteConfig({
      out: isDrizzleKit ? out : resolve(projectDir, out),
      schema: isDrizzleKit ? schema : resolve(projectDir, schema),
      dbCredentials: { url },
    });
  }),
);

export class UserDatabaseTag extends Context.Tag('@database/User')<UserDatabaseTag, Adapter<typeof userTable>>() {}

export const UserDatabaseLayer = Layer.effect(
  UserDatabaseTag,
  Effect.gen(function* () {
    const db = yield* SqliteClientTag;
    return Adapter(db, userTable);
  }),
);

export class AccountDatabaseTag extends Context.Tag('@database/Account')<AccountDatabaseTag, Adapter<typeof accountTable>>() {}

export const AccountDatabaseLayer = Layer.effect(
  AccountDatabaseTag,
  Effect.gen(function* () {
    const db = yield* SqliteClientTag;
    return Adapter(db, accountTable);
  }),
);
