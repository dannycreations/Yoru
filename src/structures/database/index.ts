import { defaultsDeep } from '@vegapunk/utilities/common';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Context, Effect, Layer } from 'effect';

import { Adapter, SqliteClientError, SqliteClientTag } from './Adapter';

import type { PatchedDialect } from './types';

export * from 'drizzle-orm/better-sqlite3';
export * from 'drizzle-orm/sqlite-core';
export { Adapter, Database, SqliteClientError, SqliteClientTag };

export class SqliteConfigTag extends Context.Tag('@database/SqliteConfig')<SqliteConfigTag, SqliteOptions>() {}

export interface SqliteOptions {
  readonly out: string;
  readonly schema: string | string[];
  readonly dbCredentials: { readonly url: string };
  readonly logger?: boolean;
  readonly breakpoints?: boolean;
  readonly tablesFilter?: string | string[];
  readonly extensionsFilters?: string[];
  readonly schemaFilter?: string | string[];
  readonly verbose?: boolean;
  readonly strict?: boolean;
  readonly casing?: 'camelCase' | 'snake_case';
  readonly migrations?: {
    readonly table?: string;
    readonly schema?: string;
    readonly prefix?: 'index' | 'timestamp' | 'supabase' | 'unix' | 'none';
  };
  readonly introspect?: {
    readonly casing: 'camel' | 'preserve';
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

export const makeSqliteConfig = (options: Partial<SqliteOptions> = {}): SqliteOptions => defaultsDeep({}, options, baseOptions);

export const SqliteClientLayer = Layer.scoped(
  SqliteClientTag,
  Effect.gen(function* () {
    const options = yield* SqliteConfigTag;

    const { db } = yield* Effect.acquireRelease(
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
          patchDialect(db.dialect as PatchedDialect);

          migrate(db, { migrationsFolder: options.out });
          return { db, client };
        },
        catch: (cause) =>
          new SqliteClientError({
            message: cause instanceof Error ? cause.message : 'Failed to initialize SQLite database',
            cause,
          }),
      }),
      ({ client }) => Effect.sync(() => client.close()),
    );

    return db;
  }),
);
