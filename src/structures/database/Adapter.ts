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
  readonly count: (filter?: QueryFilter<A>) => Effect.Effect<number, SqliteClientError, SqliteClientTag>;
  readonly find: <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter?: QueryFilter<A>,
    options?: QueryOptions<A, ExtractTables<J>, S, J>,
  ) => Effect.Effect<Array<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError, SqliteClientTag>;
  readonly findOne: <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter?: QueryFilter<A>,
    options?: Omit<QueryOptions<A, ExtractTables<J>, S, J>, 'limit'>,
  ) => Effect.Effect<Option.Option<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError, SqliteClientTag>;
  readonly findOneAndUpdate: {
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: Partial<InferSelect<A>>,
      data: Partial<Omit<Insert, 'id'>>,
      options: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { readonly upsert: true },
    ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag>;
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: QueryFilter<A>,
      data: Partial<Omit<Insert, 'id'>>,
      options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { readonly upsert?: false },
    ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag>;
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: Partial<InferSelect<A>> | QueryFilter<A>,
      data: Partial<Omit<Insert, 'id'>>,
      options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { readonly upsert?: boolean },
    ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag>;
  };
  readonly findOneAndDelete: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    filter?: QueryFilter<A>,
    options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'>,
  ) => Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag>;
  readonly insert: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Omit<Insert, 'id'> | Array<Omit<Insert, 'id'>>,
    options?: Pick<QueryOptions<A, B, S, unknown>, 'select'> & {
      conflict?: {
        resolution: 'ignore' | 'update' | 'merge';
        target: Array<keyof Omit<Insert, 'id'>>;
        set?: { [K in keyof Omit<Insert, 'id'>]?: Insert[K] | SQL<A> };
      };
    },
  ) => Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag>;
  readonly update: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options?: Pick<QueryOptions<A, B, S, unknown>, 'select'>,
  ) => Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag>;
  readonly delete: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options?: Pick<QueryOptions<A, B, S, unknown>, 'select'>,
  ) => Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag>;
}

const hasKeys = (obj?: object | null): obj is object => (obj == null ? false : Object.keys(obj).length > 0);

const withTrace = <A, E, R>(
  fn: (db: BetterSQLite3Database, trace: { value?: () => SQL }) => Effect.Effect<A, E, R>,
): Effect.Effect<A, SqliteClientError | E, SqliteClientTag | R> => {
  const trace: { value?: () => SQL } = {};
  return Effect.flatMap(SqliteClientTag, (db) =>
    fn(db, trace).pipe(
      Effect.catchAllCause((cause): Effect.Effect<never, SqliteClientError | E> => {
        const failure = Cause.failureOption(cause);
        if (Option.isSome(failure) && failure.value instanceof SqliteClientError) {
          return Effect.failCause(cause);
        }

        let query: unknown;
        if (trace.value) {
          try {
            // @ts-expect-error Internal drizzle access.
            query = db.dialect.sqlToQuery(trace.value());
          } catch {}
        }

        const defect = Cause.dieOption(cause);
        const error = Option.orElse(failure, () => defect).pipe(
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
    ),
  );
};

export const Adapter = <A extends Table, Select extends InferSelect<A> = InferSelect<A>, Insert extends InferInsert<A> = InferInsert<A>>(
  table: A,
): Adapter<A, Select, Insert> => {
  const tableWithId = table as A & { id: { primary: boolean } };
  if (!('id' in tableWithId && tableWithId.id.primary)) {
    throw new Error(`Table "${getTableName(table)}" must have a primary key "id"`);
  }

  const buildColumnCache = <B extends Array<Table>>(joins?: JoinClause<A, B>): Record<string, unknown> => {
    if (!joins || joins.length === 0) {
      return table as unknown as Record<string, unknown>;
    }

    const cache: Record<string, unknown> = {};
    for (let i = joins.length - 1; i >= 0; i--) {
      Object.assign(cache, joins[i].table);
    }
    Object.assign(cache, table);
    return cache;
  };

  const buildWhereComparison = (key: unknown, val: unknown): ReadonlyArray<SQL> => {
    const column = table[key as keyof A] as unknown as SQL;
    if (!column) return [sql`0`];
    if (val === undefined) return [];

    if (val === null || typeof val !== 'object' || Array.isArray(val)) {
      return [val === null ? isNull(column) : eq(column, val as SQL)];
    }

    const acc: SQL[] = [];
    for (const operator in val) {
      const operand = (val as Record<string, unknown>)[operator];
      if (operator === '$not') {
        const negated = buildWhereComparison(key, operand);
        if (negated.length > 0) acc.push(not(and(...negated)!));
        continue;
      }

      if (operand === null && !['$eq', '$ne', '$null'].includes(operator)) {
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

  const buildWhereLogical = (filter: QueryFilter<A>): ReadonlyArray<SQL> => {
    const acc: SQL[] = [];

    for (const key in filter) {
      const value = (filter as Record<string, unknown>)[key];
      if (['$and', '$nand', '$or', '$nor'].includes(key)) {
        const nested: SQL[] = [];
        if (Array.isArray(value)) {
          for (let j = 0; j < value.length; j++) {
            const result = buildWhereLogical(value[j] as QueryFilter<A>);
            for (let k = 0; k < result.length; k++) nested.push(result[k]);
          }
        }

        const isPositive = key === '$and' || key === '$nor';
        if (nested.length === 0) {
          acc.push(sql.raw(isPositive ? '1' : '0'));
          continue;
        }

        const joined = key === '$and' || key === '$nand' ? and(...nested) : or(...nested);
        acc.push(['$nand', '$nor'].includes(key) ? not(joined!) : joined!);
        continue;
      }

      if (key === '$not') {
        const conds = isObjectLike(value) && !Array.isArray(value) ? buildWhereLogical(value as QueryFilter<A>) : buildWhereComparison(key, value);
        if (conds.length > 0) acc.push(not(and(...conds)!));
        continue;
      }

      const result = buildWhereComparison(key, value);
      for (let j = 0; j < result.length; j++) acc.push(result[j]);
    }
    return acc;
  };

  const buildWhereClause = (filter?: QueryFilter<A>): SQL | undefined => {
    if (!filter || !hasKeys(filter)) {
      return undefined;
    }

    const conds = buildWhereLogical(filter);
    return conds.length === 0 ? undefined : and(...conds);
  };

  const buildOrderClause = <S>(columnCache: Record<string, unknown>, order?: S): SQL | undefined => {
    if (!order || !hasKeys(order)) return undefined;

    const clauses: SQL[] = [];
    const orderObj = order as Record<string, string>;
    for (const key in orderObj) {
      const column = columnCache[key] as SQL;
      if (column) {
        clauses.push(orderObj[key]?.toLowerCase() === 'desc' ? desc(column) : asc(column));
      }
    }

    return clauses.length === 0 ? undefined : (sql.join(clauses, sql.raw(', ')) as unknown as SQL);
  };

  const buildSelectClause = <S>(columnCache: Record<string, unknown>, select?: S): InferColumn<A> | undefined => {
    if (!select || !hasKeys(select)) return undefined;

    const selectObj = select as unknown as Record<string, number>;
    const columns: Record<string, unknown> = {};

    if (selectObj['id'] !== 0 && columnCache['id']) {
      columns['id'] = columnCache['id'];
    }

    for (const key in selectObj) {
      if (key === 'id' || selectObj[key] === 0 || !columnCache[key]) continue;
      columns[key] = columnCache[key];
    }

    return Object.keys(columns).length > 0 ? (columns as InferColumn<A>) : undefined;
  };

  const count = (filter: QueryFilter<A> = {}): Effect.Effect<number, SqliteClientError, SqliteClientTag> =>
    withTrace((db, trace) =>
      Effect.try({
        try: () => {
          const query = db.select({ count: countSql() }).from(table);
          query.where(buildWhereClause(filter));

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
  ): Effect.Effect<Array<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError, SqliteClientTag> =>
    withTrace((db, trace) =>
      Effect.gen(function* () {
        const columnCache = buildColumnCache(options.joins);
        const select = buildSelectClause(columnCache, options.select);
        const query = select ? db.select(select).from(table) : db.select().from(table);
        if (hasKeys(options.joins)) {
          yield* Effect.forEach(options.joins, (join) =>
            Effect.gen(function* () {
              if (!hasKeys(join)) return;

              const isCrossJoin = join.type === 'cross';
              if (!(isCrossJoin || (join.on && hasKeys(join.on)))) {
                return yield* Effect.die(new Error(`Join conditions (on) must be specified for join type "${join.type}"`));
              }

              if (isCrossJoin) {
                query.crossJoin(join.table);
              } else {
                const conds = yield* Effect.forEach(Object.entries(join.on as Record<string, string>), ([leftKey, rightKey]) => {
                  const leftCol = table[leftKey as keyof A];
                  const rightCol = (join.table as unknown as Record<string, unknown>)[rightKey!];
                  if (!(leftCol && rightCol)) {
                    return Effect.die(new Error(`Invalid join keys: ${leftKey}, ${rightKey}`));
                  }
                  return Effect.succeed(sql`${leftCol} = ${rightCol as SQL}`);
                });

                const joinMethod = JOIN_MAP[join.type as keyof typeof JOIN_MAP] ?? 'innerJoin';
                query[joinMethod](join.table, sql`(${sql.join(conds, sql.raw(' AND '))})`);
              }
            }),
          );
        }

        query.where(buildWhereClause(filter));
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
        return yield* Effect.try({
          try: () => query.all() as unknown as Array<ReturnAlias<A, ExtractTables<J>, S, J>>,
          catch: (cause) =>
            new SqliteClientError({
              message: cause instanceof Error ? cause.message : 'Find operation failed',
              cause,
            }),
        });
      }),
    );

  const findOne = <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter: QueryFilter<A> = {},
    options: Omit<QueryOptions<A, ExtractTables<J>, S, J>, 'limit'> = {},
  ): Effect.Effect<Option.Option<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError, SqliteClientTag> =>
    Effect.map(find(filter, { ...options, limit: 1 }), (arr) => Array.head(arr));

  const findOneAndUpdate = ((
    filter: Partial<InferSelect<A>> | QueryFilter<A>,
    data: Partial<Omit<Insert, 'id'>>,
    options: Omit<QueryOptions<A, Array<Table>, unknown, unknown>, 'limit' | 'joins'> & {
      readonly upsert?: boolean;
    } = {},
  ) =>
    Effect.gen(function* () {
      const isComplex =
        Object.keys(filter).some((k) => k.startsWith('$')) ||
        Object.values(filter).some((v) => isObjectLike(v) && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$')));

      if (options.upsert && isComplex) {
        return yield* Effect.fail(
          new SqliteClientError({
            message: 'Cannot use complex filter when upserting',
          }),
        );
      }

      const rOpt = yield* findOne(filter as QueryFilter<A>, { ...options, select: undefined });
      if (options.upsert && Option.isNone(rOpt)) {
        const s = yield* insert({ ...filter, ...data } as Omit<Insert, 'id'>, options as any);
        return Array.head(s);
      }

      if (Option.isSome(rOpt)) {
        const r = rOpt.value;
        const s = yield* update({ ...r, ...data } as unknown as Select, options as any);
        return Array.head(s);
      }

      return Option.none();
    })) as Adapter<A, Select, Insert>['findOneAndUpdate'];

  const findOneAndDelete = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    filter: QueryFilter<A> = {},
    options: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> = {},
  ) =>
    Effect.gen(function* () {
      const rOpt = yield* findOne(filter, { ...options, select: undefined });
      if (Option.isNone(rOpt)) return Option.none();
      const s = yield* deleteFn(rOpt.value as unknown as Select, options);
      return Array.head(s) as Option.Option<ReturnAlias<A, B, S>>;
    });

  const insert = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Omit<Insert, 'id'> | Array<Omit<Insert, 'id'>>,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> & {
      conflict?: {
        resolution: 'ignore' | 'update' | 'merge';
        target: Array<keyof Omit<Insert, 'id'>>;
        set?: { [K in keyof Omit<Insert, 'id'>]?: Insert[K] | SQL<A> };
      };
    } = {},
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag> =>
    withTrace((db, trace) =>
      Effect.try({
        try: () => {
          const input = Array.isArray(record) ? record : [record];
          const values: Insert[] = [];
          for (let i = 0; i < input.length; i++) {
            const rec = input[i] as Record<string, unknown>;
            if (hasKeys(rec)) {
              const { id, ...newRec } = rec;
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
            for (let i = 0; i < conflictOpt.target.length; i++) {
              const col = table[conflictOpt.target[i] as keyof A];
              if (col) target.push(col as unknown as SQL);
            }

            const rec = (hasKeys(conflictOpt.set) ? conflictOpt.set : values[0]) as Record<string, unknown>;

            if (conflictOpt.resolution === 'ignore') {
              query.onConflictDoNothing({ target });
            } else if (conflictOpt.resolution === 'update') {
              const { id, ...newRec } = rec;
              query.onConflictDoUpdate({ target, set: newRec as Insert });
            } else {
              const mergeSet: Record<string, unknown> = {};
              for (const key in rec) {
                if (key === 'id') continue;
                const col = table[key as keyof A];
                if (col) mergeSet[key] = sql`COALESCE(${col}, ${sql`${rec[key]}`})`;
              }
              query.onConflictDoUpdate({ target, set: mergeSet as Insert });
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
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag> =>
    withTrace((db, trace) =>
      Effect.gen(function* () {
        if (record?.id == null) {
          return yield* Effect.die(new Error('Missing required "id" for update operation'));
        }

        const query = db.update(table).set(record);
        query.where(buildWhereClause({ id: record.id } as unknown as QueryFilter<A>));

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
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag> =>
    withTrace((db, trace) =>
      Effect.gen(function* () {
        if (record?.id == null) {
          return yield* Effect.die(new Error('Missing required "id" for delete operation'));
        }

        const query = db.delete(table);
        query.where(buildWhereClause({ id: record.id } as unknown as QueryFilter<A>));

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

  return {
    count,
    find,
    findOne,
    findOneAndUpdate,
    findOneAndDelete,
    insert,
    update,
    delete: deleteFn,
  };
};
