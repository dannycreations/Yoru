import type { InferInsertModel, InferSelectModel, SQL, Table } from 'drizzle-orm';

// @ts-expect-error The buildLimit property is private within the original dialect implementation.
export interface PatchedDialect extends SQLiteSyncDialect {
  __patched?: boolean;
  buildLimit(limit: number): SQL;
  sqlToQuery(sql: SQL): unknown;
}

export interface ComparisonOperator<T> {
  readonly $eq?: T;
  readonly $ne?: T;
  readonly $gt?: T;
  readonly $gte?: T;
  readonly $lt?: T;
  readonly $lte?: T;
  readonly $like?: T;
  readonly $nlike?: T;
  readonly $glob?: T;
  readonly $nglob?: T;
  readonly $in?: Array<T>;
  readonly $nin?: Array<T>;
  readonly $null?: boolean;
  readonly $not?: ComparisonOperator<T>;
}

export interface LogicalOperator<T extends Table> {
  readonly $and?: Array<QueryBaseFilter<T> & LogicalOperator<T>>;
  readonly $nand?: Array<QueryBaseFilter<T> & LogicalOperator<T>>;
  readonly $or?: Array<QueryBaseFilter<T> & LogicalOperator<T>>;
  readonly $nor?: Array<QueryBaseFilter<T> & LogicalOperator<T>>;
  readonly $not?: QueryBaseFilter<T> & LogicalOperator<T>;
}

export type QueryBaseFilter<A extends Table> = {
  [K in keyof InferSelect<A>]?: InferSelect<A>[K] | ComparisonOperator<InferSelect<A>[K]>;
};

export type QueryFilter<A extends Table> = QueryBaseFilter<A> & LogicalOperator<A>;

export interface QueryOptions<A extends Table, B extends Array<Table>, S, J = JoinClause<A, B>> {
  readonly select?: S;
  readonly limit?: number;
  readonly offset?: number;
  readonly order?: OrderClause<A, B>;
  readonly joins?: J;
}

export type SelectClause<A extends Table, B extends Array<Table>, S> = Partial<Record<keyof SelectMerge<A, B>, 0 | 1>> &
  Readonly<Record<Exclude<keyof S, keyof SelectMerge<A, B>>, never>>;

export type SelectMerge<A extends Table, B extends Array<Table>> = InferSelect<A> & SelectTuple<B>;

export type SelectTuple<B extends Array<Table>> = B extends [infer Head, ...infer Tail]
  ? Head extends Table
    ? Tail extends Array<Table>
      ? InferSelect<Head> & SelectTuple<Tail>
      : InferSelect<Head>
    : never
  : unknown;

export type OrderClause<A extends Table, B extends Array<Table>> = OrderType<A> & OrderTuple<B>;

export type OrderTuple<B extends Array<Table>> = B extends [infer Head, ...infer Tail]
  ? Head extends Table
    ? Tail extends Array<Table>
      ? OrderType<Head> & OrderTuple<Tail>
      : OrderType<Head>
    : never
  : unknown;

export type OrderType<T extends Table> = {
  [K in keyof InferColumn<T> as K extends string ? K : never]?: 'asc' | 'desc';
};

export type JoinClause<A extends Table, B extends Array<Table>> = {
  [K in keyof B]: {
    readonly table: B[K];
    readonly on: { [L in keyof InferSelect<A>]?: keyof InferSelect<B[K]> };
    readonly type?: 'left' | 'right' | 'cross' | 'full' | 'inner';
  };
};

export type ExtractTables<J> = J extends readonly [infer Head, ...infer Tail]
  ? Head extends { table: infer T }
    ? T extends Table
      ? [T, ...ExtractTables<Tail>]
      : ExtractTables<Tail>
    : ExtractTables<Tail>
  : J extends Array<{ table: infer T }>
    ? (T extends Table ? T : never)[]
    : [];

export type IsLeftOrFull<J, T extends Table> =
  J extends Array<infer Join> ? (Extract<Join, { table: T; type: 'left' | 'full' }> extends never ? false : true) : false;

export type IsRightOrFull<J> = J extends Array<infer Join> ? (Extract<Join, { type: 'right' | 'full' }> extends never ? false : true) : false;

export type ReturnAlias<A extends Table, B extends Array<Table>, S, J extends readonly unknown[] = unknown[]> =
  S extends Record<keyof S, number>
    ? keyof S extends never
      ? B extends [infer _A, ...infer _B]
        ? { [K in A['_']['name']]: IsRightOrFull<J> extends true ? InferSelect<A> | null : InferSelect<A> } & ReturnTuple<B, J>
        : InferSelect<A>
      : Omit<
          SelectMerge<A, B>,
          Exclude<keyof SelectMerge<A, B>, { [K in keyof S]: S[K] extends 1 ? K : never }[keyof S] | (S extends { id: 0 } ? never : 'id')>
        >
    : B extends [infer _A, ...infer _B]
      ? { [K in A['_']['name']]: IsRightOrFull<J> extends true ? InferSelect<A> | null : InferSelect<A> } & ReturnTuple<B, J>
      : InferSelect<A>;

export type ReturnTuple<T extends Array<unknown>, J> = T extends [infer Head, ...infer Tail]
  ? Head extends Table
    ? { [K in Head['_']['name']]: IsLeftOrFull<J, Head> extends true ? InferSelect<Head> | null : InferSelect<Head> } & ReturnTuple<Tail, J>
    : ReturnTuple<Tail, J>
  : unknown;

export type InferColumn<T extends Table> = T['_']['columns'];
export type InferInsert<T extends Table> = InferInsertModel<T>;
export type InferSelect<T extends Table> = InferSelectModel<T>;
