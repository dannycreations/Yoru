import { resolve } from 'node:path';
import { Config, Context, Effect, Layer } from 'effect';

import { Adapter, SqliteClientLayer, SqliteClientTag, SqliteConfigTag } from '../structures/database/index.js';
import { accountTable, userTable } from './schema.js';

import type { Table } from 'drizzle-orm';

const isDrizzleKit = process.argv.toString().includes('drizzle-kit');
const projectDir = resolve(import.meta.dirname, '..', '..');

const out = './migrations';
const schema = './src/database/schema.ts';

export const SqliteConfigLayer = Layer.effect(
  SqliteConfigTag,
  Effect.gen(function* () {
    const url = yield* Config.string('SQLITE_URL').pipe(Config.withDefault('sessions/sqlite.db'));
    return {
      out: isDrizzleKit ? out : resolve(projectDir, out),
      schema: isDrizzleKit ? schema : resolve(projectDir, schema),
      dbCredentials: { url },
    };
  }),
);

const makeDatabaseLayer = <I, T extends Table>(tag: Context.Tag<I, Adapter<T>>, table: T): Layer.Layer<I, never, SqliteClientTag> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      return Adapter(yield* SqliteClientTag, table);
    }),
  );

export class UserDatabaseTag extends Context.Tag('@database/User')<UserDatabaseTag, Adapter<typeof userTable>>() {}

export const UserDatabaseLayer = makeDatabaseLayer(UserDatabaseTag, userTable);

export class AccountDatabaseTag extends Context.Tag('@database/Account')<AccountDatabaseTag, Adapter<typeof accountTable>>() {}

export const AccountDatabaseLayer = makeDatabaseLayer(AccountDatabaseTag, accountTable);

export const DatabaseLayer = Layer.mergeAll(UserDatabaseLayer, AccountDatabaseLayer).pipe(
  Layer.provideMerge(SqliteClientLayer.pipe(Layer.provide(SqliteConfigLayer))),
);
