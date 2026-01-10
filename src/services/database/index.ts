import { defaultsDeep } from '@vegapunk/utilities/common';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Effect, Layer } from 'effect';

import { Adapter, SqliteError, SqliteTag } from './Adapter';

import type { PatchedDialect } from './types';

export * from 'drizzle-orm/better-sqlite3';
export * from 'drizzle-orm/sqlite-core';
export { Adapter, Database, SqliteError, SqliteTag };

export interface SqliteOptions {
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
  out: 'migrations',
  schema: 'src/database/schema.ts',
  dbCredentials: { url: 'sessions/sqlite.db' },
} satisfies SqliteOptions & { dialect: string };

export const patchDialect = (dialect: PatchedDialect): void => {
  if (dialect.__patched) return;
  dialect.__patched = true;

  const buildLimit = dialect.buildLimit.bind(dialect);
  dialect.buildLimit = (limit: number) => (limit >= 0 ? buildLimit(limit) : sql` LIMIT -1`);
};

export const createConfig = (options: Partial<SqliteOptions> = {}): SqliteOptions => defaultsDeep({}, options, baseOptions);

export const SqliteLayer = (options: SqliteOptions): Layer.Layer<SqliteTag, SqliteError, never> =>
  Layer.scoped(
    SqliteTag,
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

          // @ts-expect-error Internal drizzle access.
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
