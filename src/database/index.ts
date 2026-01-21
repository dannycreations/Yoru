import { resolve } from 'node:path';
import { Config, Context, Effect, Layer } from 'effect';

import { Adapter, makeSqliteConfig, SqliteClientTag } from '../structures/database';
import { accountTable, userTable } from './schema';

import type { SqliteOptions } from '../structures/database';

const isDrizzleKit = process.argv.toString().includes('drizzle-kit');
const projectDir = resolve(__dirname, '..', '..');

const out = './migrations';
const schema = './src/database/schema.ts';

export class SqliteConfigTag extends Context.Tag('@database/SqliteConfig')<SqliteConfigTag, SqliteOptions>() {}

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
    yield* SqliteClientTag;
    return Adapter(userTable);
  }),
);

export class AccountDatabaseTag extends Context.Tag('@database/Account')<AccountDatabaseTag, Adapter<typeof accountTable>>() {}

export const AccountDatabaseLayer = Layer.effect(
  AccountDatabaseTag,
  Effect.gen(function* () {
    yield* SqliteClientTag;
    return Adapter(accountTable);
  }),
);
