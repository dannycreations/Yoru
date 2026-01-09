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
import { Context, Data, Effect } from 'effect';

import type { SQL, Table } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { ExtractTables, InferColumn, InferInsert, InferSelect, JoinClause, QueryFilter, QueryOptions, ReturnAlias, SelectClause } from './types';

export class DatabaseError extends Data.TaggedError('DatabaseError')<{
  readonly message: string;
  readonly cause?: unknown;
  readonly query?: unknown;
}> {}

export class SqliteDatabase extends Context.Tag('SqliteDatabase')<SqliteDatabase, BetterSQLite3Database>() {}

const JOIN_MAP = {
  left: 'leftJoin',
  right: 'rightJoin',
  full: 'fullJoin',
  inner: 'innerJoin',
} as const;

const OPERATOR_MAP: Record<string, (col: SQL, val: SQL) => SQL> = {
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
};

export interface Adapter<A extends Table, Select extends InferSelect<A>, Insert extends InferInsert<A>> {
  readonly count: (filter?: QueryFilter<A>) => Effect.Effect<number, DatabaseError, SqliteDatabase>;
  readonly find: <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter?: QueryFilter<A>,
    options?: QueryOptions<A, ExtractTables<J>, S, J>,
  ) => Effect.Effect<Array<ReturnAlias<A, ExtractTables<J>, S, J>>, DatabaseError, SqliteDatabase>;
  readonly findOne: <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter?: QueryFilter<A>,
    options?: Omit<QueryOptions<A, ExtractTables<J>, S, J>, 'limit'>,
  ) => Effect.Effect<ReturnAlias<A, ExtractTables<J>, S, J> | null, DatabaseError, SqliteDatabase>;
  readonly findOneAndUpdate: {
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: Partial<InferSelect<A>>,
      data: Partial<Omit<Insert, 'id'>>,
      options: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { upsert: true },
    ): Effect.Effect<ReturnAlias<A, B, S> | null, DatabaseError, SqliteDatabase>;
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: QueryFilter<A>,
      data: Partial<Omit<Insert, 'id'>>,
      options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { upsert?: false },
    ): Effect.Effect<ReturnAlias<A, B, S> | null, DatabaseError, SqliteDatabase>;
    <B extends Array<Table>, S extends SelectClause<A, B, S>>(
      filter: Partial<InferSelect<A>> | QueryFilter<A>,
      data: Partial<Omit<Insert, 'id'>>,
      options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { upsert?: boolean },
    ): Effect.Effect<ReturnAlias<A, B, S> | null, DatabaseError, SqliteDatabase>;
  };
  readonly findOneAndDelete: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    filter?: QueryFilter<A>,
    options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'>,
  ) => Effect.Effect<ReturnAlias<A, B, S> | null, DatabaseError, SqliteDatabase>;
  readonly insert: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Omit<Insert, 'id'> | Array<Omit<Insert, 'id'>>,
    options?: Pick<QueryOptions<A, B, S, unknown>, 'select'> & {
      conflict?: {
        resolution: 'ignore' | 'update' | 'merge';
        target: Array<keyof Omit<Insert, 'id'>>;
        set?: { [K in keyof Omit<Insert, 'id'>]?: Insert[K] | SQL<A> };
      };
    },
  ) => Effect.Effect<Array<ReturnAlias<A, B, S>>, DatabaseError, SqliteDatabase>;
  readonly update: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options?: Pick<QueryOptions<A, B, S, unknown>, 'select'>,
  ) => Effect.Effect<Array<ReturnAlias<A, B, S>>, DatabaseError, SqliteDatabase>;
  readonly delete: <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options?: Pick<QueryOptions<A, B, S, unknown>, 'select'>,
  ) => Effect.Effect<Array<ReturnAlias<A, B, S>>, DatabaseError, SqliteDatabase>;
}

export const Adapter = <A extends Table, Select extends InferSelect<A> = InferSelect<A>, Insert extends InferInsert<A> = InferInsert<A>>(
  table: A,
): Adapter<A, Select, Insert> => {
  const tableWithId = table as A & { id: { primary: boolean } };
  if (!('id' in tableWithId && tableWithId.id.primary)) {
    throw new Error(`Table "${getTableName(table)}" must have a primary key "id"`);
  }

  const hasKeys = (obj?: object | null): obj is object => {
    if (obj == null) return false;
    for (const _ in obj) return true;
    return false;
  };

  const withTrace = <T>(fn: (db: BetterSQLite3Database, trace: { value?: () => SQL }) => T): Effect.Effect<T, DatabaseError, SqliteDatabase> => {
    const trace: { value?: () => SQL } = {};
    return Effect.gen(function* () {
      const db = yield* SqliteDatabase;
      return yield* Effect.try({
        try: () => fn(db, trace),
        catch: (error) => {
          let query: unknown = undefined;
          if (trace.value) {
            try {
              // @ts-expect-error access internal drizzle
              query = db.dialect.sqlToQuery(trace.value());
            } catch {}
          }
          return new DatabaseError({
            message: error instanceof Error ? error.message : String(error),
            cause: error,
            query,
          });
        },
      });
    });
  };

  const buildColumnCache = <B extends Array<Table>>(joins?: JoinClause<A, B>): Record<string, unknown> => {
    if (!joins || joins.length === 0) {
      return table as unknown as Record<string, unknown>;
    }

    const cache: Record<string, unknown> = {};
    for (let i = joins.length - 1; i >= 0; i--) {
      Object.assign(cache, joins[i].table as unknown as Record<string, unknown>);
    }
    Object.assign(cache, table as unknown as Record<string, unknown>);
    return cache;
  };

  const buildWhereComparison = (key: unknown, val: unknown): Array<SQL> => {
    const column = table[key as keyof A] as unknown as SQL;
    if (!column) return [sql`0`];
    if (val === undefined) return [];

    if (val === null || typeof val !== 'object' || Array.isArray(val)) {
      if (val === null) return [isNull(column)];
      return [eq(column, val as SQL)];
    }

    const operation = val as Record<string, unknown>;
    const result: Array<SQL> = [];

    for (const operator in operation) {
      const operand = operation[operator];

      if (operator === '$not') {
        const negated = buildWhereComparison(key, operand);
        result.push(negated.length === 0 ? sql`0` : not(and(...negated)!));
        continue;
      }

      if (operand === null && operator !== '$eq' && operator !== '$ne' && operator !== '$null') {
        result.push(sql`0`);
        continue;
      }

      if (operator === '$eq' && operand === null) {
        result.push(isNull(column));
        continue;
      }

      if (operator === '$ne' && operand === null) {
        result.push(isNotNull(column));
        continue;
      }

      const handler = OPERATOR_MAP[operator];
      result.push(handler ? handler(column, operand as SQL) : sql`0`);
    }
    return result;
  };

  const buildWhereLogical = (filter: QueryFilter<A>): Array<SQL> => {
    const result: Array<SQL> = [];

    for (const key in filter) {
      const value = filter[key as keyof typeof filter];

      if (key === '$and' || key === '$nand' || key === '$or' || key === '$nor') {
        if (!Array.isArray(value) || value.length === 0) {
          result.push(sql.raw(key === '$and' || key === '$nor' ? '1' : '0'));
          continue;
        }

        const nested: SQL[] = [];
        const values = value as QueryFilter<A>[];
        for (let i = 0; i < values.length; i++) {
          const sub = buildWhereLogical(values[i]);
          nested.push(...sub);
        }

        if (nested.length === 0) {
          result.push(sql.raw(key === '$and' || key === '$nor' ? '1' : '0'));
          continue;
        }

        const joined = key === '$and' || key === '$nand' ? and(...nested) : or(...nested);
        result.push(key === '$nand' || key === '$nor' ? not(joined!) : joined!);
      } else if (key === '$not') {
        let conds: SQL[];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          conds = buildWhereLogical(value as QueryFilter<A>);
        } else {
          conds = buildWhereComparison(key, value);
        }
        result.push(conds.length === 0 ? sql`0` : not(and(...conds)!));
      } else {
        const conds = buildWhereComparison(key, value);
        result.push(...conds);
      }
    }

    return result;
  };

  const buildWhereClause = (filter?: QueryFilter<A>): SQL => {
    if (!filter || !hasKeys(filter)) {
      return undefined as unknown as SQL;
    }

    const conds = buildWhereLogical(filter);
    return conds.length === 0 ? (undefined as unknown as SQL) : and(...conds)!;
  };

  const buildOrderClause = <S>(columnCache: Record<string, unknown>, order?: S): SQL => {
    if (!order || !hasKeys(order)) return undefined as unknown as SQL;

    const clauses: SQL[] = [];
    for (const key in order) {
      const direction = (order as Record<string, string>)[key];
      const column = columnCache[key] as SQL;
      if (column) {
        clauses.push(direction?.toLowerCase() === 'desc' ? desc(column) : asc(column));
      }
    }

    return clauses.length === 0 ? (undefined as unknown as SQL) : (sql.join(clauses, sql.raw(', ')) as unknown as SQL);
  };

  const buildSelectClause = <S>(columnCache: Record<string, unknown>, select?: S): InferColumn<A> => {
    if (!select || !hasKeys(select)) return undefined as unknown as InferColumn<A>;

    const columns: Record<string, unknown> = {};
    let hasColumns = false;

    // Handle 'id' implicitly unless explicitly disabled
    const selectObj = select as unknown as Record<string, number>;
    if (selectObj['id'] !== 0) {
      const col = columnCache['id'];
      if (col) {
        columns['id'] = col;
        hasColumns = true;
      }
    }

    for (const key in selectObj) {
      if (key === 'id') continue;
      if (selectObj[key] === 0) continue;

      const column = columnCache[key];
      if (column) {
        columns[key] = column;
        hasColumns = true;
      }
    }

    return hasColumns ? (columns as InferColumn<A>) : (undefined as unknown as InferColumn<A>);
  };

  const count = (filter: QueryFilter<A> = {}): Effect.Effect<number, DatabaseError, SqliteDatabase> => {
    return withTrace((db, trace) => {
      const query = db.select({ count: countSql() }).from(table);
      query.where(buildWhereClause(filter));

      trace.value = () => query.getSQL();
      return query.get()?.count ?? 0;
    });
  };

  const find = <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter: QueryFilter<A> = {},
    options: QueryOptions<A, ExtractTables<J>, S, J> = {},
  ): Effect.Effect<Array<ReturnAlias<A, ExtractTables<J>, S, J>>, DatabaseError, SqliteDatabase> => {
    return withTrace((db, trace) => {
      const columnCache = buildColumnCache(options.joins);
      const select = buildSelectClause(columnCache, options.select);
      const query = db.select(select).from(table);
      if (hasKeys(options.joins)) {
        for (const join of options.joins) {
          if (!hasKeys(join)) continue;

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
        }
      }

      query.where(buildWhereClause(filter));
      if (hasKeys(options.order)) {
        query.orderBy(buildOrderClause(columnCache, options.order));
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
  };

  const findOne = <const J extends JoinClause<A, Array<Table>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter: QueryFilter<A> = {},
    options: Omit<QueryOptions<A, ExtractTables<J>, S, J>, 'limit'> = {},
  ): Effect.Effect<ReturnAlias<A, ExtractTables<J>, S, J> | null, DatabaseError, SqliteDatabase> => {
    return Effect.map(find(filter, { ...options, limit: 1 }), (r) => r[0] ?? null);
  };

  const findOneAndUpdate = ((
    filter: Partial<InferSelect<A>> | QueryFilter<A>,
    data: Partial<Omit<Insert, 'id'>>,
    options: Omit<QueryOptions<A, Array<Table>, unknown, unknown>, 'limit' | 'joins'> & {
      upsert?: boolean;
    } = {},
  ) => {
    return Effect.gen(function* () {
      const r = yield* findOne(filter as QueryFilter<A>, { ...options, select: undefined });
      if (options.upsert && r === null) {
        const isComplex =
          Object.keys(filter).some((k) => k.startsWith('$')) ||
          Object.values(filter).some((v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$')));
        if (isComplex)
          return yield* Effect.fail(
            new DatabaseError({
              message: 'Cannot use complex filter when upserting',
            }),
          );

        // @ts-expect-error avoid extensive casting
        const s = yield* insert({ ...filter, ...data }, options);
        return s[0];
      }

      if (r !== null) {
        // @ts-expect-error avoid extensive casting
        const s = yield* update({ ...r, ...data }, options);
        return s[0];
      }

      return r;
    });
  }) as Adapter<A, Select, Insert>['findOneAndUpdate'];

  const findOneAndDelete = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    filter: QueryFilter<A> = {},
    options: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> = {},
  ): Effect.Effect<ReturnAlias<A, B, S> | null, DatabaseError, SqliteDatabase> => {
    return Effect.gen(function* () {
      const r = yield* findOne(filter, { ...options, select: undefined });
      if (r === null) return r as ReturnAlias<A, B, S> | null;
      const s = yield* deleteFn(r as unknown as Select, options);
      return s[0] as ReturnAlias<A, B, S>;
    });
  };

  const insert = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Omit<Insert, 'id'> | Array<Omit<Insert, 'id'>>,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> & {
      conflict?: {
        resolution: 'ignore' | 'update' | 'merge';
        target: Array<keyof Omit<Insert, 'id'>>;
        set?: { [K in keyof Omit<Insert, 'id'>]?: Insert[K] | SQL<A> };
      };
    } = {},
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, DatabaseError, SqliteDatabase> => {
    return withTrace((db, trace) => {
      const input = Array.isArray(record) ? record : [record];
      const values: Insert[] = [];

      for (let i = 0; i < input.length; i++) {
        const rec = input[i];
        if (!hasKeys(rec)) continue;

        const { id, ...newRec } = rec as Record<string, unknown>;
        values.push(newRec as Insert);
      }

      if (values.length === 0) {
        return [];
      }

      const query = db.insert(table).values(values);
      query.returning(buildSelectClause(buildColumnCache(), options.select));

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
          const mergeSet: Record<string, unknown> = {};
          for (const key in rec) {
            if (key === 'id') continue;
            const val = rec[key];
            const col = table[key as keyof A];
            if (!col) {
              throw new Error(`Conflict set column "${key}" not found in table "${getTableName(table)}"`);
            }
            mergeSet[key] = sql`COALESCE(${col}, ${sql`${val}`})`;
          }
          query.onConflictDoUpdate({ target, set: mergeSet as Insert });
        }
      }

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
    });
  };

  const update = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> = {},
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, DatabaseError, SqliteDatabase> => {
    return withTrace((db, trace) => {
      if (record?.id == null) {
        throw new Error('Missing required "id" for update operation');
      }

      const query = db.update(table).set(record);
      query.where(buildWhereClause({ id: record.id } as unknown as QueryFilter<A>));
      query.returning(buildSelectClause(buildColumnCache(), options.select));

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
    });
  };

  const deleteFn = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> = {},
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, DatabaseError, SqliteDatabase> => {
    return withTrace((db, trace) => {
      if (record?.id == null) {
        throw new Error('Missing required "id" for delete operation');
      }

      const query = db.delete(table);
      query.where(buildWhereClause({ id: record.id } as unknown as QueryFilter<A>));
      query.returning(buildSelectClause(buildColumnCache(), options.select));

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
    });
  };

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
