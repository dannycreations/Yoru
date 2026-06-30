import { isObjectLike } from '@vegapunk/utilities/common';
import {
  and,
  asc,
  count as countSql,
  desc,
  eq,
  getTableName,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  notInArray,
  notLike,
  or,
  sql,
} from 'drizzle-orm';
import { Array, Cause, Context, Data, Effect, Option } from 'effect';

import type { SQL, Table } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { ExtractTables, InferColumn, InferInsert, InferSelect, JoinClause, QueryFilter, QueryOptions, ReturnAlias, SelectClause } from './types';

export class SqliteClientError extends Data.TaggedError('SqliteClientError')<{
  readonly message: string;
  readonly cause?: unknown;
  readonly query?: unknown;
}> {}

export class SqliteClientTag extends Context.Tag('@structures/SqliteClient')<SqliteClientTag, BetterSQLite3Database>() {}

const JOIN_MAP: Readonly<Record<string, 'leftJoin' | 'rightJoin' | 'fullJoin' | 'innerJoin'>> = {
  left: 'leftJoin',
  right: 'rightJoin',
  full: 'fullJoin',
  inner: 'innerJoin',
} as const;

const OPERATOR_MAP: Readonly<Record<string, (col: SQL, val: SQL) => SQL>> = {
  $eq: eq,
  $ne: ne,
  $gt: gt,
  $gte: gte,
  $lt: lt,
  $lte: lte,
  $like: like,
  $nlike: notLike,
  $glob: (col, val) => sql`${col} GLOB ${val}`,
  $nglob: (col, val) => sql`${col} NOT GLOB ${val}`,
  $in: (col, val) => (Array.isArray(val) && val.length > 0 ? inArray(col, val) : sql`0`),
  $nin: (col, val) => (Array.isArray(val) && val.length > 0 ? notInArray(col, val) : sql`1`),
  $null: (col, val) => (val ? isNull(col) : isNotNull(col)),
} as const;

export interface Adapter<A extends Table, Select extends InferSelect<A> = InferSelect<A>, Insert extends InferInsert<A> = InferInsert<A>> {
  readonly count: (filter?: QueryFilter<A>) => Effect.Effect<number, SqliteClientError>;
  readonly find: <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter?: QueryFilter<A>,
    options?: QueryOptions<A, ExtractTables<J>, S, J>,
  ) => Effect.Effect<Array<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError>;
  readonly findOne: <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter?: QueryFilter<A>,
    options?: Omit<QueryOptions<A, ExtractTables<J>, S, J>, 'limit'>,
  ) => Effect.Effect<Option.Option<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError>;
  readonly findOneAndUpdate: {
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: Partial<InferSelect<A>>,
      data: Partial<Omit<Insert, 'id'>>,
      options: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { readonly upsert: true },
    ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError>;
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: QueryFilter<A>,
      data: Partial<Omit<Insert, 'id'>>,
      options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { readonly upsert?: false },
    ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError>;
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: Partial<InferSelect<A>> | QueryFilter<A>,
      data: Partial<Omit<Insert, 'id'>>,
      options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { readonly upsert?: boolean },
    ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError>;
  };
  readonly findOneAndDelete: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    filter?: QueryFilter<A>,
    options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'>,
  ) => Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError>;
  readonly insert: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Omit<Insert, 'id'> | Array<Omit<Insert, 'id'>>,
    options?: Pick<QueryOptions<A, B, S, unknown>, 'select'> & {
      conflict?: {
        resolution: 'ignore' | 'update' | 'merge';
        target: Array<keyof Omit<Insert, 'id'>>;
        set?: { [K in keyof Omit<Insert, 'id'>]?: Insert[K] | SQL<A> };
      };
    },
  ) => Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError>;
  readonly update: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options?: Pick<QueryOptions<A, B, S, unknown>, 'select'>,
  ) => Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError>;
  readonly delete: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options?: Pick<QueryOptions<A, B, S, unknown>, 'select'>,
  ) => Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError>;
  readonly transaction: <T, E, R>(fn: (adapter: Adapter<A, Select, Insert>) => Effect.Effect<T, E, R>) => Effect.Effect<T, SqliteClientError | E, R>;
}

const hasKeys = (obj?: object | null): obj is object => {
  if (obj == null) return false;
  for (const _ in obj) return true;
  return false;
};

const withTrace = <A, E, R>(
  db: BetterSQLite3Database,
  fn: (db: BetterSQLite3Database, trace: { value?: () => SQL }) => Effect.Effect<A, E, R>,
): Effect.Effect<A, SqliteClientError | E, R> => {
  const trace: { value?: () => SQL } = {};
  return fn(db, trace).pipe(
    Effect.catchAllCause((cause): Effect.Effect<never, SqliteClientError | E> => {
      if (Cause.isInterruptedOnly(cause)) {
        return Effect.failCause(cause);
      }

      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure) && failure.value instanceof SqliteClientError) {
        return Effect.failCause(cause);
      }

      let query: unknown = undefined;
      if (trace.value) {
        try {
          // @ts-expect-error Internal drizzle access.
          query = db.dialect.sqlToQuery(trace.value());
        } catch {
          // Ignore query extraction errors to prioritize original cause
        }
      }

      const error = failure.pipe(
        Option.orElse(() => Cause.dieOption(cause)),
        Option.map((f) => (f instanceof Error ? f.message : String(f))),
        Option.getOrElse(() => 'Unknown database error'),
      );

      return Effect.fail(
        new SqliteClientError({
          message: error,
          cause,
          query,
        }),
      );
    }),
  );
};

export const Adapter = <A extends Table, Select extends InferSelect<A> = InferSelect<A>, Insert extends InferInsert<A> = InferInsert<A>>(
  db: BetterSQLite3Database,
  table: A,
): Adapter<A, Select, Insert> => {
  const tableWithId = table as A & { id: { primary: boolean } };
  if (!('id' in tableWithId && tableWithId.id.primary)) {
    throw new Error(`Table "${getTableName(table)}" must have a primary key "id"`);
  }

  const TableColumnsSymbol = Symbol.for('drizzle:Columns');
  // @ts-expect-error Internal drizzle access.
  const tableColumns = table[TableColumnsSymbol] as Record<string, SQL>;
  const columnCacheMap = new Map<string, Record<string, SQL>>();

  const buildColumnCache = <B extends Array<Table>>(joins?: JoinClause<A, B>): Record<string, SQL> => {
    if (!joins || joins.length === 0) {
      return tableColumns;
    }

    const cacheKey = joins.map((j) => getTableName(j.table)).join('|');
    const cached = columnCacheMap.get(cacheKey);
    if (cached) {
      return cached;
    }

    const cache: Record<string, SQL> = {};

    for (let i = joins.length - 1; i >= 0; i--) {
      const join = joins[i];
      if (!join) continue;
      // @ts-expect-error Internal drizzle access.
      const columns = join.table[TableColumnsSymbol] as Record<string, SQL>;
      if (columns) {
        for (const key in columns) {
          cache[key] = columns[key]!;
        }
      }
    }
    for (const key in tableColumns) {
      cache[key] = tableColumns[key]!;
    }

    columnCacheMap.set(cacheKey, cache);
    return cache;
  };

  const buildWhereComparison = (columnCache: Record<string, SQL>, key: string, val: unknown): SQL[] => {
    const column = columnCache[key];

    if (!column) {
      return [sql`0`];
    }

    if (val === undefined) {
      return [];
    }

    if (val === null || typeof val !== 'object' || Array.isArray(val)) {
      return [val === null ? isNull(column) : eq(column, val as SQL)];
    }

    const acc: SQL[] = [];
    const valObj = val as Record<string, unknown>;

    for (const operator in valObj) {
      const operand = valObj[operator];

      if (operator === '$not') {
        const negated = buildWhereComparison(columnCache, key, operand);
        if (negated.length > 0) {
          const joined = and(...negated);
          if (joined) acc.push(not(joined));
        }
        continue;
      }

      if (operand === null && operator !== '$eq' && operator !== '$ne' && operator !== '$null') {
        acc.push(sql`0`);
        continue;
      }

      if (operator === '$eq' && operand === null) {
        acc.push(isNull(column));
        continue;
      }

      if (operator === '$ne' && operand === null) {
        acc.push(isNotNull(column));
        continue;
      }

      const handler = OPERATOR_MAP[operator];
      acc.push(handler ? handler(column, operand as SQL) : sql`0`);
    }

    return acc;
  };

  const buildWhereLogical = (columnCache: Record<string, SQL>, filter: QueryFilter<A>): SQL[] => {
    const acc: SQL[] = [];
    const filterObj = filter as Record<string, unknown>;

    for (const key in filterObj) {
      const value = filterObj[key];

      if (key === '$and' || key === '$nand' || key === '$or' || key === '$nor') {
        const nested: SQL[] = [];

        if (Array.isArray(value)) {
          for (let j = 0, vLen = value.length; j < vLen; j++) {
            const res = buildWhereLogical(columnCache, value[j] as QueryFilter<A>);
            if (res.length > 0) {
              const joined = and(...res);
              if (joined) nested.push(joined);
            }
          }
        }

        const isPositive = key === '$and' || key === '$nor';
        if (nested.length === 0) {
          acc.push(isPositive ? sql`1` : sql`0`);
          continue;
        }

        const joined = key === '$and' || key === '$nand' ? and(...nested) : or(...nested);
        if (joined) {
          acc.push(key === '$nand' || key === '$nor' ? not(joined) : joined);
        }
        continue;
      }

      if (key === '$not') {
        const conds =
          isObjectLike(value) && !Array.isArray(value)
            ? buildWhereLogical(columnCache, value as QueryFilter<A>)
            : buildWhereComparison(columnCache, key, value as string);
        if (conds.length > 0) {
          const joined = and(...conds);
          if (joined) acc.push(not(joined));
        }
        continue;
      }

      const result = buildWhereComparison(columnCache, key, value);
      for (let j = 0, rLen = result.length; j < rLen; j++) {
        acc.push(result[j]!);
      }
    }
    return acc;
  };

  const buildWhereClause = (columnCache: Record<string, SQL>, filter?: QueryFilter<A>): SQL | undefined => {
    if (!filter || !hasKeys(filter)) {
      return undefined;
    }

    const conds = buildWhereLogical(columnCache, filter);
    if (conds.length === 0) return undefined;
    if (conds.length === 1) return conds[0];
    return and(...conds);
  };

  const buildOrderClause = <S>(columnCache: Record<string, unknown>, order?: S): SQL | undefined => {
    if (!order || !hasKeys(order)) return undefined;

    const clauses: SQL[] = [];
    const orderObj = order as Record<string, string>;
    for (const key in orderObj) {
      const column = columnCache[key] as SQL;
      if (!column) {
        continue;
      }

      const value = orderObj[key];
      clauses.push(value?.toLowerCase() === 'desc' ? desc(column) : asc(column));
    }

    return clauses.length === 0 ? undefined : sql.join(clauses, sql.raw(', '));
  };

  const buildSelectClause = <S>(columnCache: Record<string, unknown>, select?: S): InferColumn<A> | undefined => {
    if (!select || !hasKeys(select)) return undefined;

    const selectObj = select as Record<string, number>;
    const columns: Record<string, unknown> = {};

    if (selectObj['id'] !== 0 && columnCache['id']) {
      columns['id'] = columnCache['id'];
    }

    for (const key in selectObj) {
      if (key === 'id' || selectObj[key] === 0 || !columnCache[key]) {
        continue;
      }

      columns[key] = columnCache[key];
    }

    return Object.keys(columns).length > 0 ? (columns as InferColumn<A>) : undefined;
  };

  const count = (filter: QueryFilter<A> = {}): Effect.Effect<number, SqliteClientError> =>
    withTrace(db, (db, trace) =>
      Effect.try({
        try: () => {
          const query = db.select({ count: countSql() }).from(table);
          query.where(buildWhereClause(tableColumns, filter));

          trace.value = () => query.getSQL();
          return query.get()?.count ?? 0;
        },
        catch: (cause) =>
          new SqliteClientError({
            message: cause instanceof Error ? cause.message : 'Count operation failed',
            cause,
          }),
      }),
    );

  const find = <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter: QueryFilter<A> = {},
    options: QueryOptions<A, ExtractTables<J>, S, J> = {},
  ): Effect.Effect<Array<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError> =>
    withTrace(db, (db, trace) =>
      Effect.try({
        try: () => {
          const columnCache = buildColumnCache(options.joins);
          const select = buildSelectClause(columnCache, options.select);
          const query = select ? db.select(select).from(table) : db.select().from(table);

          const joins = options.joins;
          if (joins && joins.length > 0) {
            for (let i = 0, len = joins.length; i < len; i++) {
              const join = joins[i];
              if (!join || !hasKeys(join)) {
                continue;
              }

              const isCrossJoin = join.type === 'cross';

              if (!isCrossJoin && !(join.on && hasKeys(join.on))) {
                throw new Error(`Join conditions (on) must be specified for join type "${join.type}"`);
              }

              if (isCrossJoin) {
                query.crossJoin(join.table);
                continue;
              }

              const conds: SQL[] = [];
              const joinOn = join.on as Record<string, string>;
              for (const leftKey in joinOn) {
                const rightKey = joinOn[leftKey];
                const leftCol = columnCache[leftKey];
                // @ts-expect-error Internal drizzle access.
                const rightCol = join.table[TableColumnsSymbol][rightKey!];

                if (!leftCol || !rightCol) {
                  throw new Error(`Invalid join keys: ${leftKey}, ${rightKey}`);
                }

                conds.push(eq(leftCol as unknown as SQL, rightCol as SQL));
              }

              const joinMethod = JOIN_MAP[join.type as keyof typeof JOIN_MAP] ?? 'innerJoin';
              const onSql = conds.length === 1 ? conds[0]! : and(...conds)!;

              query[joinMethod](join.table, onSql);
            }
          }

          const where = buildWhereClause(columnCache, filter);
          if (where) {
            query.where(where);
          }

          const orderClause = buildOrderClause(columnCache, options.order);
          if (orderClause) {
            query.orderBy(orderClause);
          }

          if (typeof options.limit === 'number') {
            query.limit(options.limit);
          }

          if (typeof options.offset === 'number') {
            query.offset(options.offset);
          }

          trace.value = () => query.getSQL();
          return query.all() as unknown as Array<ReturnAlias<A, ExtractTables<J>, S, J>>;
        },
        catch: (cause) =>
          new SqliteClientError({
            message: cause instanceof Error ? cause.message : 'Find operation failed',
            cause,
          }),
      }),
    );

  const findOne = <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter: QueryFilter<A> = {},
    options: Omit<QueryOptions<A, ExtractTables<J>, S, J>, 'limit'> = {},
  ): Effect.Effect<Option.Option<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError> =>
    Effect.map(find(filter, { ...options, limit: 1 }), (arr) => Array.head(arr));

  const findOneAndUpdate = ((
    filter: Partial<InferSelect<A>> | QueryFilter<A>,
    data: Partial<Omit<Insert, 'id'>>,
    options: Omit<QueryOptions<A, Array<Table>, unknown, unknown>, 'limit' | 'joins'> & {
      readonly upsert?: boolean;
    } = {},
  ) =>
    Effect.gen(function* () {
      const isComplexFilter = (f: Record<string, unknown>): boolean => {
        for (const k in f) {
          if (k.startsWith('$')) return true;
          const v = f[k];
          if (isObjectLike(v) && !Array.isArray(v)) {
            for (const sk in v as Record<string, unknown>) {
              if (sk.startsWith('$')) return true;
            }
          }
        }
        return false;
      };

      if (options.upsert && isComplexFilter(filter as Record<string, unknown>)) {
        return yield* new SqliteClientError({
          message: 'Cannot use complex filter when upserting',
        });
      }

      if (options.upsert) {
        return yield* transaction((adapter) =>
          Effect.gen(function* () {
            const rOpt = yield* adapter.findOne(filter as QueryFilter<A>, { ...options, select: undefined });
            if (Option.isNone(rOpt)) {
              const s = yield* adapter.insert({ ...filter, ...data } as Omit<Insert, 'id'>, options as any);
              return Array.head(s);
            }

            if (!hasKeys(data)) {
              return rOpt;
            }

            const s = yield* adapter.update({ ...rOpt.value, ...data } as unknown as Select, options as any);
            return Array.head(s);
          }),
        );
      }

      if (!hasKeys(data)) {
        return yield* findOne(filter as QueryFilter<A>, options as any);
      }

      return yield* withTrace(db, (db, trace) =>
        Effect.try({
          try: () => {
            const columnCache = buildColumnCache();
            const query = db.update(table).set(data as any);

            const filterObj = filter as Record<string, unknown>;
            if (!options.order && 'id' in filterObj && Object.keys(filterObj).length === 1) {
              query.where(eq(table['id' as keyof A] as unknown as SQL, filterObj.id as any));
            } else {
              query.where(
                inArray(
                  table['id' as keyof A] as unknown as SQL,
                  db
                    .select({ id: table['id' as keyof A] as unknown as SQL })
                    .from(table)
                    .where(buildWhereClause(columnCache, filter as QueryFilter<A>))
                    .orderBy(buildOrderClause(columnCache, options.order) ?? sql`1`)
                    .limit(1),
                ),
              );
            }

            const select = buildSelectClause(columnCache, options.select);
            select ? query.returning(select) : query.returning();

            trace.value = () => query.getSQL();
            return Option.fromNullable(query.get()) as unknown as Option.Option<ReturnAlias<A, Array<Table>, any, any>>;
          },
          catch: (cause) =>
            new SqliteClientError({
              message: cause instanceof Error ? cause.message : 'Update operation failed',
              cause,
            }),
        }),
      );
    })) as Adapter<A, Select, Insert>['findOneAndUpdate'];

  const findOneAndDelete = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    filter: QueryFilter<A> = {},
    options: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> = {},
  ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError> =>
    withTrace(db, (db, trace) =>
      Effect.try({
        try: () => {
          const columnCache = buildColumnCache();
          const filterObj = filter as Record<string, unknown>;
          const query = db.delete(table);

          if (!options.order && 'id' in filterObj && Object.keys(filterObj).length === 1) {
            query.where(eq(table['id' as keyof A] as unknown as SQL, filterObj.id as any));
          } else {
            query.where(
              inArray(
                table['id' as keyof A] as unknown as SQL,
                db
                  .select({ id: table['id' as keyof A] as unknown as SQL })
                  .from(table)
                  .where(buildWhereClause(columnCache, filter))
                  .orderBy(buildOrderClause(columnCache, options.order) ?? sql`1`)
                  .limit(1),
              ),
            );
          }

          const select = buildSelectClause(columnCache, options.select);
          select ? query.returning(select) : query.returning();

          trace.value = () => query.getSQL();
          return Option.fromNullable(query.get()) as unknown as Option.Option<ReturnAlias<A, B, S>>;
        },
        catch: (cause) =>
          new SqliteClientError({
            message: cause instanceof Error ? cause.message : 'Delete operation failed',
            cause,
          }),
      }),
    );

  const insert = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Omit<Insert, 'id'> | Array<Omit<Insert, 'id'>>,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> & {
      conflict?: {
        resolution: 'ignore' | 'update' | 'merge';
        target: Array<keyof Omit<Insert, 'id'>>;
        set?: { [K in keyof Omit<Insert, 'id'>]?: Insert[K] | SQL<A> };
      };
    } = {},
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError> =>
    withTrace(db, (db, trace) =>
      Effect.try({
        try: () => {
          const values: Insert[] = [];
          if (Array.isArray(record)) {
            for (let i = 0, len = record.length; i < len; i++) {
              const rec = record[i] as Record<string, unknown>;
              if (!rec || !hasKeys(rec)) continue;
              const newRec = { ...rec };
              delete newRec.id;
              values.push(newRec as Insert);
            }
          } else {
            const rec = record as Record<string, unknown>;
            if (rec && hasKeys(rec)) {
              const newRec = { ...rec };
              delete newRec.id;
              values.push(newRec as Insert);
            }
          }

          if (values.length === 0) {
            return [];
          }

          const query = db.insert(table).values(values);

          const conflictOpt = options.conflict;
          if (hasKeys(conflictOpt)) {
            const target: SQL[] = [];
            const targetKeys = conflictOpt.target;
            for (let i = 0, len = targetKeys.length; i < len; i++) {
              const col = table[targetKeys[i] as keyof A] as unknown as SQL;
              if (col) target.push(col);
            }

            const resolution = conflictOpt.resolution;
            if (resolution === 'ignore') {
              query.onConflictDoNothing({ target });
            } else {
              const rec = (hasKeys(conflictOpt.set) ? conflictOpt.set : values[0]) as Record<string, any>;
              if (resolution === 'update') {
                const newRec = { ...rec };
                delete newRec.id;
                query.onConflictDoUpdate({ target, set: newRec as Insert });
              } else if (resolution === 'merge') {
                const mergeSet: Record<string, any> = {};
                const keys = Object.keys(rec);
                for (let i = 0, len = keys.length; i < len; i++) {
                  const key = keys[i]!;
                  if (key === 'id') continue;

                  const col = table[key as keyof A] as unknown as SQL;
                  if (!col) continue;

                  const value = rec[key];
                  mergeSet[key] = sql`COALESCE(${col}, ${sql`${value}`})`;
                }
                query.onConflictDoUpdate({ target, set: mergeSet as Insert });
              }
            }
          }

          const select = buildSelectClause(buildColumnCache(), options.select);
          select ? query.returning(select) : query.returning();

          trace.value = () => query.getSQL();
          return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
        },
        catch: (cause) =>
          new SqliteClientError({
            message: cause instanceof Error ? cause.message : 'Insert operation failed',
            cause,
          }),
      }),
    );

  const update = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> = {},
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError> =>
    withTrace(db, (db, trace) =>
      Effect.gen(function* () {
        if (record?.id == null) {
          return yield* Effect.die(new Error('Missing required "id" for update operation'));
        }

        const query = db.update(table).set(record);
        query.where(eq(table['id' as keyof A] as unknown as SQL, record.id as unknown as SQL));

        const select = buildSelectClause(buildColumnCache(), options.select);
        select ? query.returning(select) : query.returning();

        trace.value = () => query.getSQL();
        return yield* Effect.try({
          try: () => query.all() as unknown as Array<ReturnAlias<A, B, S>>,
          catch: (cause) =>
            new SqliteClientError({
              message: cause instanceof Error ? cause.message : 'Update operation failed',
              cause,
            }),
        });
      }),
    );

  const deleteFn = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> = {},
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError> =>
    withTrace(db, (db, trace) =>
      Effect.gen(function* () {
        if (record?.id == null) {
          return yield* Effect.die(new Error('Missing required "id" for delete operation'));
        }

        const query = db.delete(table);
        query.where(eq(table['id' as keyof A] as unknown as SQL, record.id as unknown as SQL));

        const select = buildSelectClause(buildColumnCache(), options.select);
        select ? query.returning(select) : query.returning();

        trace.value = () => query.getSQL();
        return yield* Effect.try({
          try: () => query.all() as unknown as Array<ReturnAlias<A, B, S>>,
          catch: (cause) =>
            new SqliteClientError({
              message: cause instanceof Error ? cause.message : 'Delete operation failed',
              cause,
            }),
        });
      }),
    );

  const transaction = <T, E, R>(fn: (adapter: Adapter<A, Select, Insert>) => Effect.Effect<T, E, R>): Effect.Effect<T, SqliteClientError | E, R> =>
    Effect.context<R>().pipe(
      Effect.flatMap((ctx) =>
        withTrace(db, (db) =>
          Effect.try({
            try: () =>
              db.transaction((tx) => {
                const adapter = Adapter(tx as any, table);
                return Effect.runSync(Effect.provide(fn(adapter as any), ctx));
              }),
            catch: (cause) =>
              new SqliteClientError({
                message: cause instanceof Error ? cause.message : 'Transaction failed',
                cause,
              }),
          }),
        ),
      ),
    );

  return {
    count,
    find,
    findOne,
    findOneAndUpdate,
    findOneAndDelete,
    insert,
    update,
    delete: deleteFn,
    transaction,
  };
};
