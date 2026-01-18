import { join, resolve } from 'node:path';
import { Config, Context, Effect, Layer } from 'effect';

import { Adapter, makeSqliteConfig, SqliteClientTag } from '../structures/database';
import { accountTable, userTable } from './schema';

const isDrizzleKit = process.argv.toString().includes('drizzle-kit');
const projectDir = resolve(__dirname, '..', '..');

const out = './migrations';
const schema = './src/database/schema.ts';

export const sqliteConfig = Effect.gen(function* () {
  const url = yield* Config.string('SQLITE_URL').pipe(Config.withDefault('sessions/sqlite.db'));
  return makeSqliteConfig({
    out: isDrizzleKit ? out : join(projectDir, out),
    schema: isDrizzleKit ? schema : join(projectDir, schema),
    dbCredentials: { url },
  });
});

export class UserDatabaseTag extends Context.Tag('@database/User')<UserDatabaseTag, Adapter<typeof userTable>>() {}

export const UserDatabaseLayer = Layer.effect(
  UserDatabaseTag,
  Effect.map(SqliteClientTag, () => Adapter(userTable)),
);

export class AccountDatabaseTag extends Context.Tag('@database/Account')<AccountDatabaseTag, Adapter<typeof accountTable>>() {}

export const AccountDatabaseLayer = Layer.effect(
  AccountDatabaseTag,
  Effect.map(SqliteClientTag, () => Adapter(accountTable)),
);
