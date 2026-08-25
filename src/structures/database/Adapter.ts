import { isPlainObject } from '@vegapunk/utilities/common';
import {
  and,
  asc,
  bindIfParam,
  count as countSql,
  desc,
  eq,
  getTableName,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { Array, Context, Data, Effect, Option, Runtime } from 'effect';

import type { Column, SQL, Table } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Cause } from 'effect';
import type {
  ExtractTables,
  InferColumn,
  InferInsert,
  InferSelect,
  JoinClause,
  QueryFilter,
  QueryOptions,
  ReturnAlias,
  SelectClause,
  TransactionOptions,
} from './types.js';

export class SqliteClientError extends Data.TaggedError('SqliteClientError')<{
  readonly message: string;
  readonly cause?: unknown;
  readonly query?: unknown;
}> {}

export class SqliteClientTag extends Context.Tag('@structures/SqliteClient')<SqliteClientTag, BetterSQLite3Database>() {}

const TableColumnsSymbol = Symbol.for('drizzle:Columns');

const createLookup = <T>(entries: Record<string, T>): Readonly<Record<string, T>> => Object.assign(Object.create(null) as Record<string, T>, entries);

const SQL_TRUE = sql`1`;
const SQL_FALSE = sql`0`;
const SQL_UNKNOWN = sql`null`;
const SQL_NO_LIMIT = sql`-1`;

const JOIN_MAP = createLookup<'leftJoin' | 'rightJoin' | 'fullJoin' | 'innerJoin'>({
  left: 'leftJoin',
  right: 'rightJoin',
  full: 'fullJoin',
  inner: 'innerJoin',
});

const OPERATOR_MAP = createLookup<(col: SQL, val: SQL) => SQL>({
  $eq: eq,
  $ne: ne,
  $gt: gt,
  $gte: gte,
  $lt: lt,
  $lte: lte,
  $like: (col, val) => sql`${col} like ${bindIfParam(val, col)}`,
  $nlike: (col, val) => sql`${col} not like ${bindIfParam(val, col)}`,
  $glob: (col, val) => sql`${col} glob ${bindIfParam(val, col)}`,
  $nglob: (col, val) => sql`${col} not glob ${bindIfParam(val, col)}`,
  $in: (col, val) => (Array.isArray(val) && val.length > 0 ? inArray(col, val) : SQL_FALSE),
  $nin: (col, val) => (Array.isArray(val) && val.length > 0 ? notInArray(col, val) : SQL_TRUE),
  $null: (col, val) => (val ? isNull(col) : isNotNull(col)),
});

const LOGICAL_KEYS = createLookup<true>({ $and: true, $nand: true, $or: true, $nor: true });
const CONJUNCTION_KEYS = createLookup<true>({ $and: true, $nand: true });
const NEGATED_KEYS = createLookup<true>({ $nand: true, $nor: true });
const NULLABLE_OPERATORS = createLookup<true>({ $eq: true, $ne: true, $null: true, $in: true, $nin: true });

export interface Adapter<A extends Table, Select extends InferSelect<A> = InferSelect<A>, Insert extends InferInsert<A> = InferInsert<A>> {
  readonly count: (filter?: QueryFilter<A>) => Effect.Effect<number, SqliteClientError>;
  readonly find: <const J extends JoinClause<A, ExtractTables<J>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter?: QueryFilter<A>,
    options?: QueryOptions<A, ExtractTables<J>, S, J>,
  ) => Effect.Effect<Array<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError>;
  readonly findOne: <const J extends JoinClause<A, ExtractTables<J>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter?: QueryFilter<A>,
    options?: Omit<QueryOptions<A, ExtractTables<J>, S, J>, 'limit'>,
  ) => Effect.Effect<Option.Option<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError>;
  readonly findOneAndUpdate: <B extends Array<Table>, S extends SelectClause<A, B, S>, U extends boolean = false>(
    filter: U extends true ? Partial<InferSelect<A>> : QueryFilter<A>,
    data: Partial<Omit<Insert, 'id'>>,
    options?: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> & { readonly upsert?: U },
  ) => Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError>;
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
  readonly transaction: <T, E, R>(
    fn: (adapter: Adapter<A, Select, Insert>) => Effect.Effect<T, E, R>,
    options?: TransactionOptions,
  ) => Effect.Effect<T, SqliteClientError | E, R>;
}

const hasKeys = (obj?: object | null): obj is object => {
  if (obj == null) return false;
  for (const _ in obj) return true;
  return false;
};

const omitUndefinedId = (record: object): Record<string, unknown> => {
  const acc: Record<string, unknown> = {};
  for (const key in record) {
    if (key === 'id') continue;

    const value = (record as Record<string, unknown>)[key];
    if (value === undefined) continue;

    acc[key] = value;
  }
  return acc;
};

const isBindableId = (value: unknown): value is string | number | bigint => {
  const type = typeof value;
  return type === 'number' || type === 'string' || type === 'bigint';
};

const isOperatorFilter = (value: object): boolean => {
  if (!isPlainObject(value)) {
    return false;
  }

  for (const key in value) {
    if (key.charCodeAt(0) === 36) return true;
  }
  return false;
};

const buildWhereComparison = (columns: Record<string, SQL>, key: string, value: unknown, acc: SQL[]): void => {
  const column = columns[key];

  if (!column) {
    throw new Error(`Unknown column "${key}" in query filter`);
  }

  if (value === undefined) {
    return;
  }

  if (value === null) {
    acc.push(isNull(column));
    return;
  }

  if (typeof value !== 'object' || !isOperatorFilter(value)) {
    acc.push(eq(column, value as SQL));
    return;
  }

  const operators = value as Record<string, unknown>;

  for (const operator in operators) {
    const operand = operators[operator];

    if (operand === undefined) {
      continue;
    }

    if (operator === '$not') {
      const negated: SQL[] = [];
      buildWhereComparison(columns, key, operand, negated);
      if (negated.length === 0) {
        continue;
      }

      acc.push(not(negated.length === 1 ? negated[0]! : and(...negated)!));
      continue;
    }

    if (operand === null) {
      if (operator === '$eq') {
        acc.push(isNull(column));
        continue;
      }

      if (operator === '$ne') {
        acc.push(isNotNull(column));
        continue;
      }

      if (!NULLABLE_OPERATORS[operator]) {
        acc.push(operator in OPERATOR_MAP ? SQL_UNKNOWN : SQL_FALSE);
        continue;
      }
    }

    const handler = OPERATOR_MAP[operator];
    acc.push(handler ? handler(column, operand as SQL) : SQL_FALSE);
  }
};

const buildWhereGroup = (columns: Record<string, SQL>, key: string, value: unknown, acc: SQL[]): void => {
  const isConjunction = CONJUNCTION_KEYS[key] === true;
  const isNegated = NEGATED_KEYS[key] === true;

  if (!Array.isArray(value)) {
    acc.push(SQL_FALSE);
    return;
  }

  const nested: SQL[] = [];
  let absorbed = false;

  for (let i = 0, len = value.length; i < len; i++) {
    const member = value[i];

    if (!isPlainObject(member)) {
      nested.push(SQL_FALSE);
      continue;
    }

    const conds: SQL[] = [];
    buildWhereLogical(columns, member as Record<string, unknown>, conds);

    if (conds.length === 0) {
      if (isConjunction) continue;

      absorbed = true;
      break;
    }

    nested.push(conds.length === 1 ? conds[0]! : and(...conds)!);
  }

  if (absorbed) {
    acc.push(isNegated ? SQL_FALSE : SQL_TRUE);
    return;
  }

  if (nested.length === 0) {
    acc.push(isConjunction === isNegated ? SQL_FALSE : SQL_TRUE);
    return;
  }

  const joined = (isConjunction ? and(...nested) : or(...nested))!;
  acc.push(isNegated ? not(joined) : joined);
};

const buildWhereLogical = (columns: Record<string, SQL>, filter: Record<string, unknown>, acc: SQL[]): void => {
  for (const key in filter) {
    const value = filter[key];

    if (LOGICAL_KEYS[key]) {
      buildWhereGroup(columns, key, value, acc);
      continue;
    }

    if (key === '$not') {
      if (!isPlainObject(value)) {
        acc.push(SQL_FALSE);
        continue;
      }

      const conds: SQL[] = [];
      buildWhereLogical(columns, value as Record<string, unknown>, conds);
      if (conds.length === 0) {
        acc.push(SQL_FALSE);
        continue;
      }

      acc.push(not(conds.length === 1 ? conds[0]! : and(...conds)!));
      continue;
    }

    buildWhereComparison(columns, key, value, acc);
  }
};

const buildWhereClause = (columns: Record<string, SQL>, filter?: Record<string, unknown>): SQL | undefined => {
  if (!hasKeys(filter)) {
    return undefined;
  }

  const conds: SQL[] = [];
  buildWhereLogical(columns, filter as Record<string, unknown>, conds);

  if (conds.length === 0) return undefined;
  if (conds.length === 1) return conds[0];
  return and(...conds);
};

const buildOrderClause = (columns: Record<string, SQL>, order?: unknown): SQL[] => {
  const clauses: SQL[] = [];
  if (!hasKeys(order as object)) return clauses;

  const orderObj = order as Record<string, string>;
  for (const key in orderObj) {
    const column = columns[key];
    if (!column) {
      throw new Error(`Unknown column "${key}" in query order`);
    }

    const value = orderObj[key];
    clauses.push(value?.toLowerCase() === 'desc' ? desc(column) : asc(column));
  }

  return clauses;
};

const buildSelectClause = (columns: Record<string, SQL>, select?: unknown): Record<string, SQL> | undefined => {
  if (!hasKeys(select as object)) return undefined;

  const selectObj = select as Record<string, unknown>;
  const acc: Record<string, SQL> = {};

  let hasInclude = false;
  for (const key in selectObj) {
    if (selectObj[key]) {
      hasInclude = true;
      break;
    }
  }

  if (!hasInclude) {
    for (const key in columns) {
      acc[key] = columns[key]!;
    }

    for (const key in selectObj) {
      if (selectObj[key] === undefined) continue;

      delete acc[key];
    }
  } else {
    const idFlag = selectObj['id'];
    if ((idFlag === undefined || !!idFlag) && columns['id']) {
      acc['id'] = columns['id']!;
    }

    for (const key in selectObj) {
      const column = columns[key];
      if (key === 'id' || !selectObj[key] || !column) {
        continue;
      }

      acc[key] = column;
    }
  }

  if (!hasKeys(acc)) {
    throw new Error('Query option "select" must keep at least one column');
  }

  return acc;
};

const normalizeRowCount = (value: number | undefined, option: string): number | undefined => {
  if (value === undefined) return undefined;

  if (!Number.isInteger(value)) {
    throw new Error(`Query option "${option}" must be an integer, received ${String(value)}`);
  }

  return value;
};

interface QueryTrace {
  value?: () => SQL;
}

const toClientError = (db: BetterSQLite3Database, trace: QueryTrace, message: string, cause: unknown): SqliteClientError => {
  let query: unknown = undefined;
  if (trace.value) {
    try {
      // @ts-expect-error Internal drizzle access.
      query = db.dialect.sqlToQuery(trace.value());
    } catch {}
  }

  return new SqliteClientError({
    message: cause instanceof Error ? cause.message : message,
    cause,
    query,
  });
};

const execute = <A>(db: BetterSQLite3Database, message: string, run: (trace: QueryTrace) => A): Effect.Effect<A, SqliteClientError> =>
  Effect.suspend(() => {
    const trace: QueryTrace = {};
    try {
      return Effect.succeed(run(trace));
    } catch (cause) {
      return Effect.fail(toClientError(db, trace, message, cause));
    }
  });

const columnCacheStore = new WeakMap<Table, Map<string, Record<string, SQL>>>();
const tableColumnStore = new WeakMap<Table, Readonly<Record<string, SQL>>>();

const getTableColumns = (table: Table): Readonly<Record<string, SQL>> => {
  let columns = tableColumnStore.get(table);
  if (!columns) {
    // @ts-expect-error Internal drizzle access.
    columns = createLookup(table[TableColumnsSymbol] as Record<string, SQL>);
    tableColumnStore.set(table, columns);
  }
  return columns;
};

export const Adapter = <A extends Table, Select extends InferSelect<A> = InferSelect<A>, Insert extends InferInsert<A> = InferInsert<A>>(
  db: BetterSQLite3Database,
  table: A,
): Adapter<A, Select, Insert> => {
  const idColumn = (table as unknown as Record<string, Column | undefined>)['id'];
  if (!idColumn?.primary) {
    throw new Error(`Table "${getTableName(table)}" must have a primary key "id"`);
  }

  const idSql = idColumn as unknown as SQL;
  const tableColumns = getTableColumns(table);
  const idAscOrder: SQL[] = [asc(idSql)];

  const buildColumnCache = <B extends Array<Table>>(joins?: JoinClause<A, B>): Record<string, SQL> => {
    if (!joins || joins.length === 0) {
      return tableColumns;
    }

    let cacheMap = columnCacheStore.get(table);
    if (!cacheMap) {
      cacheMap = new Map();
      columnCacheStore.set(table, cacheMap);
    }

    let cacheKey = '';
    for (let i = 0, len = joins.length; i < len; i++) {
      const join = joins[i];
      cacheKey += (join ? getTableName(join.table) : '') + '|';
    }

    const cached = cacheMap.get(cacheKey);
    if (cached) {
      return cached;
    }

    const cache: Record<string, SQL> = Object.create(null);

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

    cacheMap.set(cacheKey, cache);
    return cache;
  };

  const matchFirstRow = (filter: Record<string, unknown>, order?: unknown): SQL => {
    let orderClause = buildOrderClause(tableColumns, order);

    if (orderClause.length === 0) {
      let single: string | undefined;
      let keys = 0;
      for (const key in filter) {
        single = key;
        if (++keys > 1) break;
      }

      if (keys === 1 && single === 'id' && isBindableId(filter['id'])) {
        return eq(idSql, filter['id'] as unknown as SQL);
      }

      orderClause = idAscOrder;
    }

    return inArray(
      idSql,
      db
        .select({ id: idSql })
        .from(table)
        .where(buildWhereClause(tableColumns, filter))
        .orderBy(...orderClause)
        .limit(1),
    );
  };

  const count = (filter: QueryFilter<A> = {}): Effect.Effect<number, SqliteClientError> =>
    execute(db, 'Count operation failed', (trace) => {
      const query = db.select({ count: countSql() }).from(table);
      query.where(buildWhereClause(tableColumns, filter as Record<string, unknown>));

      trace.value = () => query.getSQL();
      return query.get()?.count ?? 0;
    });

  const find = <const J extends JoinClause<A, ExtractTables<J>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
    filter: QueryFilter<A> = {},
    options: QueryOptions<A, ExtractTables<J>, S, J> = {},
  ): Effect.Effect<Array<ReturnAlias<A, ExtractTables<J>, S, J>>, SqliteClientError> =>
    execute(db, 'Find operation failed', (trace) => {
      const limit = normalizeRowCount(options.limit, 'limit');
      const offset = normalizeRowCount(options.offset, 'offset');

      const columnCache = buildColumnCache(options.joins);
      const select = buildSelectClause(columnCache, options.select);
      const query = select ? db.select(select as unknown as InferColumn<A>).from(table) : db.select().from(table);

      const joins = options.joins;
      if (joins && joins.length > 0) {
        for (let i = 0, len = joins.length; i < len; i++) {
          const join = joins[i];
          if (!join || !hasKeys(join)) {
            continue;
          }

          const isCrossJoin = join.type === 'cross';

          if (!isCrossJoin && !hasKeys(join.on)) {
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
            const rightCol = (join.table as Record<symbol, Record<string, SQL> | undefined>)[TableColumnsSymbol]?.[rightKey!];

            if (!leftCol || !rightCol) {
              throw new Error(`Invalid join keys: ${leftKey}, ${rightKey}`);
            }

            conds.push(eq(leftCol, rightCol as SQL));
          }

          const joinMethod = JOIN_MAP[join.type as keyof typeof JOIN_MAP] ?? 'innerJoin';
          const onSql = conds.length === 1 ? conds[0]! : and(...conds)!;

          query[joinMethod](join.table, onSql);
        }
      }

      const where = buildWhereClause(columnCache, filter as Record<string, unknown>);
      if (where) {
        query.where(where);
      }

      const orderClause = buildOrderClause(columnCache, options.order);
      if (orderClause.length > 0) {
        query.orderBy(...orderClause);
      }

      const hasOffset = typeof offset === 'number' && offset !== 0;
      if (typeof limit === 'number') {
        query.limit(limit < 0 ? (SQL_NO_LIMIT as unknown as number) : limit);
      } else if (hasOffset) {
        // SQLite rejects OFFSET without LIMIT; `-1` means "no limit".
        query.limit(SQL_NO_LIMIT as unknown as number);
      }

      if (hasOffset) {
        query.offset(offset!);
      }

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, ExtractTables<J>, S, J>>;
    });

  const findOne = <const J extends JoinClause<A, ExtractTables<J>> = [], S extends SelectClause<A, ExtractTables<J>, S> = {}>(
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
          if (k.charCodeAt(0) === 36) return true;

          const v = f[k];
          if (v !== null && typeof v === 'object' && isOperatorFilter(v)) return true;
        }
        return false;
      };

      if (options.upsert && isComplexFilter(filter as Record<string, unknown>)) {
        return yield* new SqliteClientError({
          message: 'Cannot use complex filter when upserting',
        });
      }

      const values = data ? omitUndefinedId(data) : {};
      const hasData = hasKeys(values);

      if (options.upsert) {
        return yield* transaction(
          (adapter) =>
            Effect.gen(function* () {
              const lookup = (hasData ? { order: options.order, select: { id: 1 } } : options) as never;
              const rOpt = yield* adapter.findOne(filter as QueryFilter<A>, lookup);
              if (Option.isNone(rOpt)) {
                const s = yield* adapter.insert({ ...filter, ...values } as Omit<Insert, 'id'>, options as never);
                return Array.head(s);
              }

              if (!hasData) {
                return rOpt;
              }

              const s = yield* adapter.update({ id: (rOpt.value as { id: unknown }).id, ...values } as unknown as Select, options as never);
              return Array.head(s);
            }),
          { behavior: 'immediate' },
        );
      }

      if (!hasData) {
        return yield* findOne(filter as QueryFilter<A>, options as never);
      }

      return yield* execute(db, 'Update operation failed', (trace) => {
        const query = db.update(table).set(values as never);
        query.where(matchFirstRow(filter as Record<string, unknown>, options.order));

        const select = buildSelectClause(tableColumns, options.select);
        select ? query.returning(select as unknown as InferColumn<A>) : query.returning();

        trace.value = () => query.getSQL();
        return Option.fromNullable(query.get()) as unknown as Option.Option<ReturnAlias<A, Array<Table>, never, never>>;
      });
    })) as Adapter<A, Select, Insert>['findOneAndUpdate'];

  const findOneAndDelete = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    filter: QueryFilter<A> = {},
    options: Omit<QueryOptions<A, B, S, unknown>, 'limit' | 'joins'> = {},
  ): Effect.Effect<Option.Option<ReturnAlias<A, B, S>>, SqliteClientError> =>
    execute(db, 'Delete operation failed', (trace) => {
      const query = db.delete(table);
      query.where(matchFirstRow(filter as Record<string, unknown>, options.order));

      const select = buildSelectClause(tableColumns, options.select);
      select ? query.returning(select as unknown as InferColumn<A>) : query.returning();

      trace.value = () => query.getSQL();
      return Option.fromNullable(query.get()) as unknown as Option.Option<ReturnAlias<A, B, S>>;
    });

  const dialectCasing = (() => {
    try {
      // @ts-expect-error Internal drizzle access.
      return (db.dialect?.casing as { getColumnCasing(col: Column): string } | undefined) ?? undefined;
    } catch {
      return undefined;
    }
  })();

  const excludedColumn = (column: SQL): SQL => {
    const col = column as unknown as Column;
    let name = col.name;
    if (dialectCasing) {
      try {
        name = dialectCasing.getColumnCasing(col);
      } catch {}
    }
    return sql`excluded.${sql.identifier(name)}`;
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
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError> =>
    execute(db, 'Insert operation failed', (trace) => {
      const records = Array.isArray(record) ? record : [record];
      const values: Insert[] = [];
      let defaultRows = 0;
      for (let i = 0, len = records.length; i < len; i++) {
        const rec = records[i] as Record<string, unknown> | undefined;
        if (rec == null) continue;

        defaultRows++;

        const newRec: Record<string, unknown> = {};
        for (const key in rec) {
          if (key === 'id') continue;
          newRec[key] = rec[key];
        }

        if (hasKeys(newRec)) values.push(newRec as Insert);
      }

      if (values.length === 0) {
        if (defaultRows === 0) {
          return [];
        }

        const conflictOpt = options.conflict;
        let statement = sql`insert into ${table} default values`;
        if (hasKeys(conflictOpt)) {
          const targetKeys = (conflictOpt.target as ReadonlyArray<string> | undefined) ?? [];
          const targetColumns = targetKeys.filter((k) => tableColumns[k]).map((k) => sql.identifier(k));
          const resolution = conflictOpt.resolution;

          if (resolution === 'ignore') {
            statement =
              targetColumns.length > 0
                ? sql`${statement} on conflict (${sql.join(targetColumns)}) do nothing`
                : sql`${statement} on conflict do nothing`;
          } else if (targetColumns.length === 0) {
            throw new Error(`Conflict resolution "${resolution}" requires at least one valid target column`);
          } else if (!hasKeys(conflictOpt.set)) {
            throw new Error(`Conflict resolution "${resolution}" with an empty record requires an explicit conflict "set"`);
          } else {
            const setPairs: Array<{ lhs: SQL; rhs: SQL }> = [];
            const explicitSet = conflictOpt.set as Record<string, unknown>;
            for (const key in explicitSet) {
              if (key === 'id' || explicitSet[key] === undefined) continue;
              const col = tableColumns[key];
              if (!col) continue;
              setPairs.push({ lhs: col, rhs: sql`${explicitSet[key]}` });
            }

            if (setPairs.length === 0) {
              throw new Error(`Conflict resolution "${resolution}" requires at least one valid column to set`);
            }

            const action =
              resolution === 'merge'
                ? sql.join(
                    setPairs.map((p) => sql`${p.lhs} = coalesce(${p.lhs}, ${p.rhs})`),
                    sql`, `,
                  )
                : sql.join(
                    setPairs.map((p) => sql`${p.lhs} = ${p.rhs}`),
                    sql`, `,
                  );

            statement = sql`${statement} on conflict (${sql.join(targetColumns)}) do update set ${action}`;
          }
        }

        const select = buildSelectClause(tableColumns, options.select);
        statement = select ? sql`${statement} returning ${sql.join(Object.values(select), sql`, `)}` : sql`${statement} returning *`;

        const out: Array<ReturnAlias<A, B, S>> = [];
        for (let i = 0; i < defaultRows; i++) {
          const row = db.get<Record<string, unknown>>(statement as never);
          if (row) out.push(row as ReturnAlias<A, B, S>);
        }

        trace.value = () => statement;
        return out;
      }

      const query = db.insert(table).values(values);

      const conflictOpt = options.conflict;
      if (hasKeys(conflictOpt)) {
        const target: SQL[] = [];
        const targetKeys = conflictOpt.target;
        if (Array.isArray(targetKeys)) {
          for (let i = 0, len = targetKeys.length; i < len; i++) {
            const col = tableColumns[targetKeys[i] as string];
            if (col) target.push(col);
          }
        }

        const resolution = conflictOpt.resolution;
        if (resolution === 'ignore') {
          target.length > 0 ? query.onConflictDoNothing({ target }) : query.onConflictDoNothing();
        } else {
          if (resolution !== 'update' && resolution !== 'merge') {
            throw new Error(`Unsupported conflict resolution "${resolution}"`);
          }

          if (target.length === 0) {
            throw new Error(`Conflict resolution "${resolution}" requires at least one valid target column`);
          }

          const explicit = hasKeys(conflictOpt.set) ? (conflictOpt.set as Record<string, unknown>) : undefined;
          const source: Record<string, unknown> = {};
          if (explicit) {
            for (const key in explicit) {
              if (key === 'id' || explicit[key] === undefined) continue;
              source[key] = explicit[key];
            }
          } else {
            const targetColumns = new Set((conflictOpt.target as ReadonlyArray<string> | undefined) ?? []);
            for (let i = 0, len = values.length; i < len; i++) {
              const rec = values[i] as Record<string, unknown>;
              for (const key in rec) {
                if (key === 'id' || key in source || targetColumns.has(key)) continue;
                const col = tableColumns[key];
                if (col) source[key] = excludedColumn(col);
              }
            }
          }

          const set: Record<string, unknown> = {};
          for (const key in source) {
            const col = tableColumns[key];
            if (!col) continue;

            set[key] = resolution === 'merge' ? sql`coalesce(${col}, ${bindIfParam(source[key], col)})` : source[key];
          }

          if (!hasKeys(set)) {
            throw new Error(`Conflict resolution "${resolution}" requires at least one valid column to set`);
          }

          query.onConflictDoUpdate({ target, set: set as never });
        }
      }

      const select = buildSelectClause(tableColumns, options.select);
      select ? query.returning(select as unknown as InferColumn<A>) : query.returning();

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
    });

  const update = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> = {},
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError> =>
    execute(db, 'Update operation failed', (trace) => {
      const id = record?.id;
      if (id == null) {
        throw new Error('Missing required "id" for update operation');
      }

      const where = eq(idSql, id as unknown as SQL);
      const select = buildSelectClause(tableColumns, options.select);
      const values = omitUndefinedId(record);

      if (!hasKeys(values)) {
        const read = select ? db.select(select as unknown as InferColumn<A>).from(table) : db.select().from(table);
        read.where(where);
        read.limit(1);

        trace.value = () => read.getSQL();
        return read.all() as unknown as Array<ReturnAlias<A, B, S>>;
      }

      const query = db.update(table).set(values as never);
      query.where(where);

      select ? query.returning(select as unknown as InferColumn<A>) : query.returning();

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
    });

  const deleteFn = <B extends Array<Table>, S extends SelectClause<A, B, S>>(
    record: Select,
    options: Pick<QueryOptions<A, B, S, unknown>, 'select'> = {},
  ): Effect.Effect<Array<ReturnAlias<A, B, S>>, SqliteClientError> =>
    execute(db, 'Delete operation failed', (trace) => {
      const id = record?.id;
      if (id == null) {
        throw new Error('Missing required "id" for delete operation');
      }

      const query = db.delete(table);
      query.where(eq(idSql, id as unknown as SQL));

      const select = buildSelectClause(tableColumns, options.select);
      select ? query.returning(select as unknown as InferColumn<A>) : query.returning();

      trace.value = () => query.getSQL();
      return query.all() as unknown as Array<ReturnAlias<A, B, S>>;
    });

  const transaction = <T, E, R>(
    fn: (adapter: Adapter<A, Select, Insert>) => Effect.Effect<T, E, R>,
    options?: TransactionOptions,
  ): Effect.Effect<T, SqliteClientError | E, R> =>
    Effect.context<R>().pipe(
      Effect.flatMap((ctx) =>
        Effect.suspend((): Effect.Effect<T, SqliteClientError | E> => {
          try {
            return Effect.succeed(
              db.transaction((tx) => {
                const adapter = Adapter(tx as unknown as BetterSQLite3Database, table);
                return Effect.runSync(Effect.provide(fn(adapter as unknown as Adapter<A, Select, Insert>), ctx));
              }, options),
            );
          } catch (cause) {
            if (Runtime.isFiberFailure(cause)) {
              return Effect.failCause(cause[Runtime.FiberFailureCauseId] as Cause.Cause<SqliteClientError | E>);
            }

            return Effect.fail(
              new SqliteClientError({
                message: cause instanceof Error ? cause.message : 'Transaction failed',
                cause,
              }),
            );
          }
        }),
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
