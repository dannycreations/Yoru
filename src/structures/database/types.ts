import type { InferInsertModel, InferSelectModel, Table } from 'drizzle-orm';

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
  readonly $in?: ReadonlyArray<T>;
  readonly $nin?: ReadonlyArray<T>;
  readonly $null?: boolean;
  readonly $not?: ComparisonOperator<T>;
}

export interface LogicalOperator<T extends Table> {
  readonly $and?: ReadonlyArray<QueryBaseFilter<T> & LogicalOperator<T>>;
  readonly $nand?: ReadonlyArray<QueryBaseFilter<T> & LogicalOperator<T>>;
  readonly $or?: ReadonlyArray<QueryBaseFilter<T> & LogicalOperator<T>>;
  readonly $nor?: ReadonlyArray<QueryBaseFilter<T> & LogicalOperator<T>>;
  readonly $not?: QueryBaseFilter<T> & LogicalOperator<T>;
}

export type QueryBaseFilter<A extends Table> = {
  [K in keyof InferSelect<A>]?: InferSelect<A>[K] | ComparisonOperator<InferSelect<A>[K]>;
};

export type QueryFilter<A extends Table> = QueryBaseFilter<A> & LogicalOperator<A>;

export interface QueryOptions<A extends Table, B extends ReadonlyArray<Table>, S, J = JoinClause<A, B>> {
  readonly select?: S;
  readonly limit?: number;
  readonly offset?: number;
  readonly order?: OrderClause<A, B>;
  readonly joins?: J;
}

export interface TransactionOptions {
  readonly behavior?: 'deferred' | 'immediate' | 'exclusive';
}

export type SelectClause<A extends Table, B extends ReadonlyArray<Table>, S> = Partial<Record<keyof SelectMerge<A, B>, 0 | 1>> &
  Readonly<Record<Exclude<keyof S, keyof SelectMerge<A, B>>, never>>;

export type SelectInclude<S> = { [K in keyof S]: S[K] extends 1 ? K : never }[keyof S];

export type SelectExclude<S> = { [K in keyof S]: S[K] extends 0 ? K : never }[keyof S];

export type SelectProject<A extends Table, B extends ReadonlyArray<Table>, S> = [SelectInclude<S>] extends [never]
  ? Omit<SelectMerge<A, B>, Extract<SelectExclude<S>, keyof SelectMerge<A, B>>>
  : Omit<SelectMerge<A, B>, Exclude<keyof SelectMerge<A, B>, SelectInclude<S> | (S extends { id: 0 } ? never : 'id')>>;

export type SelectMerge<A extends Table, B extends ReadonlyArray<Table>> = InferSelect<A> & SelectTuple<B>;

export type SelectTuple<B extends ReadonlyArray<Table>> = B extends readonly [infer Head, ...infer Tail]
  ? Head extends Table
    ? Tail extends ReadonlyArray<Table>
      ? InferSelect<Head> & SelectTuple<Tail>
      : InferSelect<Head>
    : never
  : unknown;

export type OrderClause<A extends Table, B extends ReadonlyArray<Table>> = OrderType<A> & OrderTuple<B>;

export type OrderTuple<B extends ReadonlyArray<Table>> = B extends readonly [infer Head, ...infer Tail]
  ? Head extends Table
    ? Tail extends ReadonlyArray<Table>
      ? OrderType<Head> & OrderTuple<Tail>
      : OrderType<Head>
    : never
  : unknown;

export type OrderType<T extends Table> = {
  [K in keyof InferColumn<T> as K extends string ? K : never]?: 'asc' | 'desc';
};

export type JoinClause<A extends Table, B extends ReadonlyArray<Table>> = {
  readonly [K in keyof B]: {
    readonly table: B[K];
    readonly on: { readonly [L in keyof InferSelect<A>]?: keyof InferSelect<B[K]> };
    readonly type?: 'left' | 'right' | 'cross' | 'full' | 'inner';
  };
};

export type ExtractTables<J> = J extends readonly [infer Head, ...infer Tail]
  ? Head extends { table: infer T }
    ? T extends Table
      ? [T, ...ExtractTables<Tail>]
      : ExtractTables<Tail>
    : ExtractTables<Tail>
  : J extends ReadonlyArray<{ table: infer T }>
    ? ReadonlyArray<T extends Table ? T : never>
    : readonly [];

export type IsLeftOrFull<J, T extends Table> =
  J extends ReadonlyArray<infer Join> ? (Extract<Join, { table: T; type: 'left' | 'full' }> extends never ? false : true) : false;

export type IsRightOrFull<J> = J extends ReadonlyArray<infer Join> ? (Extract<Join, { type: 'right' | 'full' }> extends never ? false : true) : false;

export type ReturnAlias<A extends Table, B extends ReadonlyArray<Table>, S, J extends readonly unknown[] = unknown[]> =
  S extends Record<keyof S, number>
    ? keyof S extends never
      ? B extends readonly [infer _A, ...infer _B]
        ? {
            readonly [K in A['_']['name']]: IsRightOrFull<J> extends true ? InferSelect<A> | null : InferSelect<A>;
          } & ReturnTuple<B, J>
        : InferSelect<A>
      : SelectProject<A, B, S>
    : B extends readonly [infer _A, ...infer _B]
      ? {
          readonly [K in A['_']['name']]: IsRightOrFull<J> extends true ? InferSelect<A> | null : InferSelect<A>;
        } & ReturnTuple<B, J>
      : InferSelect<A>;

export type ReturnTuple<T extends ReadonlyArray<unknown>, J> = T extends readonly [infer Head, ...infer Tail]
  ? Head extends Table
    ? {
        readonly [K in Head['_']['name']]: IsLeftOrFull<J, Head> extends true ? InferSelect<Head> | null : InferSelect<Head>;
      } & ReturnTuple<Tail, J>
    : ReturnTuple<Tail, J>
  : unknown;

export type InferColumn<T extends Table> = T['_']['columns'];
export type InferInsert<T extends Table> = InferInsertModel<T>;
export type InferSelect<T extends Table> = InferSelectModel<T>;
