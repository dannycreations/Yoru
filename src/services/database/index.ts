import { defaultsDeep } from '@vegapunk/utilities/common';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Data, Effect, Layer } from 'effect';

import { Adapter, SqliteDatabase } from './Adapter';

import type { PatchedDialect } from './types';

export * from 'drizzle-orm/better-sqlite3';
export * from 'drizzle-orm/sqlite-core';
export { Adapter, Database, SqliteDatabase };

export class SqliteError extends Data.TaggedError('SqliteError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface BSqliteOptions {
  out: string;
  schema: string | string[];
  dbCredentials: { url: string };
  logger?: boolean;
  breakpoints?: boolean;
  tablesFilter?: string | string[];
  extensionsFilters?: string[];
  schemaFilter?: string | string[];
  verbose?: boolean;
  strict?: boolean;
  casing?: 'camelCase' | 'snake_case';
  migrations?: {
    table?: string;
    schema?: string;
    prefix?: 'index' | 'timestamp' | 'supabase' | 'unix' | 'none';
  };
  introspect?: {
    casing: 'camel' | 'preserve';
  };
}

const baseOptions = {
  dialect: 'sqlite',
  casing: 'snake_case',
  out: 'src/lib/database/migrations',
  schema: 'src/lib/database/schema.ts',
  dbCredentials: { url: 'sessions/bsqlite.db' },
} satisfies BSqliteOptions & { dialect: string };

export function patchDialect(dialect: PatchedDialect): void {
  if (dialect.__patched) return;
  dialect.__patched = true;

  const buildLimit = dialect.buildLimit.bind(dialect);
  dialect.buildLimit = (limit: number) => (limit >= 0 ? buildLimit(limit) : sql` LIMIT -1`);
}

export const SqliteLayer = (options: BSqliteOptions) =>
  Layer.scoped(
    SqliteDatabase,
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          const client = new Database(options.dbCredentials.url);
          client.pragma('foreign_keys = ON');
          client.pragma('journal_mode = WAL');

          const db = drizzle(client, {
            casing: options.casing,
            logger: options.logger,
          });

          // @ts-expect-error access internal drizzle dialect
          patchDialect(db.dialect);

          migrate(db, { migrationsFolder: options.out });
          return { db, client };
        },
        catch: (error) =>
          new SqliteError({
            message: 'Failed to initialize SQLite database',
            cause: error,
          }),
      }),
      ({ client }) => Effect.sync(() => client.close()),
    ).pipe(Effect.map(({ db }) => db)),
  );

export function config(options: Partial<BSqliteOptions> = {}): BSqliteOptions {
  return defaultsDeep({}, options, baseOptions);
}
