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
import { Array, Context, Data, Effect, Option } from 'effect';

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
      options: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { upsert: true },
    ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag>;
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: QueryFilter<A>,
      data: Partial<Omit<Insert, 'id'>>,
      options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { upsert?: false },
    ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError, SqliteClientTag>;
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: Partial<InferSelect<A>> | QueryFilter<A>,
      data: Partial<Omit<Insert, 'id'>>,
      options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { upsert?: boolean },
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

const withTrace = <A>(fn: (db: BetterSQLite3Database, trace: { value?: () => SQL }) => A) => {
  const trace: { value?: () => SQL } = {};
  return Effect.gen(function* () {
    const db = yield* SqliteClientTag;
    return yield* Effect.try({
      try: () => fn(db, trace),
      catch: (cause) => {
        let query: unknown;
        if (trace.value) {
          try {
            // @ts-expect-error Internal drizzle access.
            query = db.dialect.sqlToQuery(trace.value());
          } catch {}
        }
        return new SqliteClientError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          query,
        });
      },
    });
  });
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

    const cache = Array.reduceRight(joins, {} as Record<string, unknown>, (acc, join) => Object.assign(acc, join.table));
    return Object.assign(cache, table);
  };

  const buildWhereComparison = (key: unknown, val: unknown): ReadonlyArray<SQL> => {
    const column = table[key as keyof A] as unknown as SQL;
    if (!column) return [sql`0`];
    if (val === undefined) return [];

    if (val === null || typeof val !== 'object' || Array.isArray(val)) {
      return [val === null ? isNull(column) : eq(column, val as SQL)];
    }

    return Array.reduce(Object.entries(val as Record<string, unknown>), [] as ReadonlyArray<SQL>, (acc, [operator, operand]) => {
      if (operator === '$not') {
        const negated = buildWhereComparison(key, operand);
        return negated.length > 0 ? [...acc, not(and(...negated)!)] : acc;
      }

      if (operand === null && !['$eq', '$ne', '$null'].includes(operator)) {
        return [...acc, sql`0`];
      }

      if (operator === '$eq' && operand === null) {
        return [...acc, isNull(column)];
      }

      if (operator === '$ne' && operand === null) {
        return [...acc, isNotNull(column)];
      }

      const handler = OPERATOR_MAP[operator];
      return [...acc, handler ? handler(column, operand as SQL) : sql`0`];
    });
  };

  const buildWhereLogical = (filter: QueryFilter<A>): ReadonlyArray<SQL> =>
    Array.reduce(Object.entries(filter), [] as ReadonlyArray<SQL>, (acc, [key, value]) => {
      if (['$and', '$nand', '$or', '$nor'].includes(key)) {
        const nested = Array.isArray(value) ? (value as QueryFilter<A>[]).flatMap((v) => buildWhereLogical(v)) : [];
        const isPositive = key === '$and' || key === '$nor';

        if (nested.length === 0) {
          return [...acc, sql.raw(isPositive ? '1' : '0')];
        }

        const joined = key === '$and' || key === '$nand' ? and(...nested) : or(...nested);
        return [...acc, ['$nand', '$nor'].includes(key) ? not(joined!) : joined!];
      }

      if (key === '$not') {
        const conds = isObjectLike(value) && !Array.isArray(value) ? buildWhereLogical(value as QueryFilter<A>) : buildWhereComparison(key, value);
        return conds.length > 0 ? [...acc, not(and(...conds)!)] : acc;
      }

      return [...acc, ...buildWhereComparison(key, value)];
    });

  const buildWhereClause = (filter?: QueryFilter<A>): SQL | undefined => {
    if (!filter || !hasKeys(filter)) {
      return undefined;
    }

    const conds = buildWhereLogical(filter);
    return conds.length === 0 ? undefined : and(...conds);
  };

  const buildOrderClause = <S>(columnCache: Record<string, unknown>, order?: S): SQL | undefined => {
    if (!order || !hasKeys(order)) return undefined;

    const clauses = Array.reduce(Object.entries(order as Record<string, string>), [] as SQL[], (acc, [key, direction]) => {
      const column = columnCache[key] as SQL;
      return column ? [...acc, direction?.toLowerCase() === 'desc' ? desc(column) : asc(column)] : acc;
    });

    return clauses.length === 0 ? undefined : (sql.join(clauses, sql.raw(', ')) as unknown as SQL);
  };

  const buildSelectClause = <S>(columnCache: Record<string, unknown>, select?: S): InferColumn<A> | undefined => {
    if (!select || !hasKeys(select)) return undefined;

    const selectObj = select as unknown as Record<string, number>;
    const columns = Array.reduce(
      Object.entries(selectObj),
      selectObj['id'] !== 0 && columnCache['id'] ? { id: columnCache['id'] } : ({} as Record<string, unknown>),
      (acc, [key, value]) => {
        if (key === 'id' || value === 0 || !columnCache[key]) return acc;
        return { ...acc, [key]: columnCache[key] };
      },
    );

    return hasKeys(columns) ? (columns as InferColumn<A>) : undefined;
  };

  const count = (filter: QueryFilter<A> = {}) =>
    withTrace((db, trace) => {
      const query = db.select({ count: countSql() }).from(table);
      query.where(buildWhereClause(filter));

      trace.value = () => query.getSQL();
      return query.get()?.count ?? 0;
    });

  const find = <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter: QueryFilter<A> = {},
    options: QueryOptions<A, ExtractTables<J>, S, J> = {},
  ) =>
    withTrace((db, trace) => {
      const columnCache = buildColumnCache(options.joins);
      const select = buildSelectClause(columnCache, options.select);
      const query = select ? db.select(select).from(table) : db.select().from(table);
      if (hasKeys(options.joins)) {
        Array.forEach(options.joins, (join) => {
          if (!hasKeys(join)) return;

          const isCrossJoin = join.type === 'cross';
          if (!(isCrossJoin || (join.on && hasKeys(join.on)))) {
            throw new Error(`Join conditions (on) must be specified for join type "${join.type}"`);
          }

          if (isCrossJoin) {
            query.crossJoin(join.table);
          } else {
            const conds = Object.entries(join.on as Record<string, string>).map(([leftKey, rightKey]) => {
              const leftCol = table[leftKey as keyof A];
              const rightCol = (join.table as unknown as Record<string, unknown>)[rightKey!];
              if (!(leftCol && rightCol)) {
                throw new Error(`Invalid join keys: ${leftKey}, ${rightKey}`);
              }
              return sql`${leftCol} = ${rightCol as SQL}`;
            });

            const joinMethod = JOIN_MAP[join.type as keyof typeof JOIN_MAP] ?? 'innerJoin';
            query[joinMethod](join.table, sql`(${sql.join(conds, sql.raw(' AND '))})`);
          }
        });
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
      return query.all() as unknown as Array<ReturnAlias<A, ExtractTables<J>, S, J>>;
    });

  const findOne = <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter: QueryFilter<A> = {},
    options: Omit<QueryOptions<A, ExtractTables<J>, S, J>, 'limit'> = {},
  ) => Effect.map(find(filter, { ...options, limit: 1 }), (r) => Option.fromNullable(r[0]));

  const findOneAndUpdate = ((
    filter: Partial<InferSelect<A>> | QueryFilter<A>,
    data: Partial<Omit<Insert, 'id'>>,
    options: Omit<QueryOptions<A, Array<Table>, unknown, unknown>, 'limit' | 'joins'> & {
      upsert?: boolean;
    } = {},
  ) =>
    Effect.gen(function* () {
      const rOpt = yield* findOne(filter as QueryFilter<A>, { ...options, select: undefined });
      if (options.upsert && Option.isNone(rOpt)) {
        const isComplex =
          Object.keys(filter).some((k) => k.startsWith('$')) ||
          Object.values(filter).some((v) => isObjectLike(v) && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$')));
        if (isComplex) {
          return yield* Effect.fail(
            new SqliteClientError({
              message: 'Cannot use complex filter when upserting',
            }),
          );
        }

        // @ts-expect-error Avoid extensive casting.
        const s = yield* insert({ ...filter, ...data }, options);
        return Option.fromNullable(s[0]);
      }

      if (Option.isSome(rOpt)) {
        const r = rOpt.value;
        // @ts-expect-error Avoid extensive casting.
        const s = yield* update({ ...r, ...data }, options);
        return Option.fromNullable(s[0]);
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
      return Option.fromNullable(s[0]) as Option.Option<ReturnAlias<A, B, S>>;
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
  ) =>
    withTrace((db, trace) => {
      const input = Array.isArray(record) ? record : [record];
      const values = Array.filterMap(input, (rec) => {
        if (!hasKeys(rec)) return Option.none();
        const { id, ...newRec } = rec as Record<string, unknown>;
        return Option.some(newRec as Insert);
      });

      if (values.length === 0) {
        return [];
      }

      const query = db.insert(table).values(values);

      const conflictOpt = options.conflict;
      if (hasKeys(conflictOpt)) {
        const target = conflictOpt.target.map((r) => {
          const col = table[r as keyof A];
          if (!col) {
            throw new Error(`Conflict target column "${String(r)}" not found in table "${getTableName(table)}"`);
          }
          return col as unknown as SQL;
        });

        const rec = (hasKeys(conflictOpt.set) ? conflictOpt.set : values[0]) as Record<string, unknown>;

        if (conflictOpt.resolution === 'ignore') {
          query.onConflictDoNothing({ target });
        } else if (conflictOpt.resolution === 'update') {
          const { id, ...newRec } = rec as Record<string, unknown>;
          query.onConflictDoUpdate({ target, set: newRec as Insert });
        } else {
          const mergeSet = Array.reduce(Object.entries(rec), {} as Record<string, unknown>, (acc, [key, val]) => {
            if (key === 'id') return acc;
            const col = table[key as keyof A];
            if (!col) {
              throw new Error(`Conflict set column "${key}" not found in table "${getTableName(table)}"`);
            }
            return { ...acc, [key]: sql`COALESCE(${col}, ${sql`${val}`})` };
          });
          query.onConflictDoUpdate({ target, set: mergeSet as Insert });
        }
      }

      const select = buildSelectClause(buildColumnCache(), options.select);
      select ? query.returning(select) : query.returning();

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
    });

  const update = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> = {},
  ) =>
    withTrace((db, trace) => {
      if (record?.id == null) {
        throw new Error('Missing required "id" for update operation');
      }

      const query = db.update(table).set(record);
      query.where(buildWhereClause({ id: record.id } as unknown as QueryFilter<A>));

      const select = buildSelectClause(buildColumnCache(), options.select);
      select ? query.returning(select) : query.returning();

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
    });

  const deleteFn = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> = {},
  ) =>
    withTrace((db, trace) => {
      if (record?.id == null) {
        throw new Error('Missing required "id" for delete operation');
      }

      const query = db.delete(table);
      query.where(buildWhereClause({ id: record.id } as unknown as QueryFilter<A>));

      const select = buildSelectClause(buildColumnCache(), options.select);
      select ? query.returning(select) : query.returning();

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
    });

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
