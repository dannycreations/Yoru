import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it as itBase } from '@effect/vitest';
import { sql } from 'drizzle-orm';
import { blob, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { Cause, Data, Effect, Exit, Layer, Option } from 'effect';
import { afterAll, afterEach, assert, beforeAll, beforeEach, describe, expect, expectTypeOf } from 'vitest';

import {
  Adapter,
  BetterSQLite3Database,
  Database,
  drizzle,
  makeSqliteConfig,
  SqliteClientError,
  SqliteClientLayer,
  SqliteClientTag,
  SqliteConfigTag,
} from './index.js';

const it = Object.assign((...args: Parameters<typeof itBase>) => itBase(...args), itBase) as any;

it.effect = (name: string, self: () => Effect.Effect<void, never>, timeout?: number) =>
  itBase.effect(name, () => Effect.provideService(self(), SqliteClientTag, db), timeout);

const officesTable = sqliteTable('offices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  location: text('location'),
});
type Office = typeof officesTable.$inferSelect;
type InsertOffice = typeof officesTable.$inferInsert;

const usersTable = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').unique(),
  age: integer('age'),
  role: text('role').default('user'),
  officeId: integer('office_id').references(() => officesTable.id, { onDelete: 'cascade' }),
  bio: text('bio'),
});
type User = typeof usersTable.$inferSelect;
type InsertUser = typeof usersTable.$inferInsert;

const postsTable = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  content: text('content'),
  userId: integer('user_id').references(() => usersTable.id, { onDelete: 'cascade' }),
  views: integer('views').default(0),
});
type Post = typeof postsTable.$inferSelect;
type InsertPost = typeof postsTable.$inferInsert;

const noIdTable = sqliteTable('no_id_table', {
  pk_col: integer('pk_col').primaryKey(),
  data: text('data'),
});

const uniquePairTable = sqliteTable(
  'unique_pair_table',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    valA: text('val_a'),
    valB: text('val_b'),
    valC: text('val_c'),
  },
  (table) => ({
    abUnique: unique('ab_unique_constraint').on(table.valA, table.valB),
  }),
);
type UniquePair = typeof uniquePairTable.$inferSelect;
type InsertUniquePair = typeof uniquePairTable.$inferInsert;

const typedTable = sqliteTable('typed_table', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull().unique(),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }),
  active: integer('active', { mode: 'boolean' }),
  payload: blob('payload', { mode: 'buffer' }),
  meta: text('meta', { mode: 'json' }).$type<{ tag: string }>(),
});
type Typed = typeof typedTable.$inferSelect;
type InsertTyped = typeof typedTable.$inferInsert;

const defaultsTable = sqliteTable('defaults_table', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  a: text('a'),
  b: integer('b').default(42),
});
type DefaultsRow = typeof defaultsTable.$inferSelect;
type InsertDefaults = typeof defaultsTable.$inferInsert;

const DATE_A = new Date('2020-01-01T00:00:00.000Z');
const DATE_B = new Date('2021-06-15T12:30:00.000Z');

const casingTable = sqliteTable('casing_table', {
  id: integer().primaryKey({ autoIncrement: true }),
  userKey: text().notNull().unique(),
  displayName: text(),
});

const sampleOffices: Array<Omit<InsertOffice, 'id'>> = [
  { name: 'HQ', location: 'New York' },
  { name: 'Branch West', location: 'San Francisco' },
  { name: 'Branch East', location: 'Boston' },
  { name: 'Remote Hub', location: null },
];

const sampleUsers: Array<Omit<InsertUser, 'id'>> = [
  { name: 'Alice', email: 'alice@example.com', age: 30, role: 'admin', officeId: 1, bio: 'Software Engineer' },
  { name: 'Bob', email: 'bob@example.com', age: 24, role: 'user', officeId: 2, bio: 'Product Manager' },
  { name: 'Charlie', email: 'charlie@example.com', age: 35, role: 'user', officeId: 1, bio: 'Data Scientist' },
  { name: 'David', email: 'david@example.com', age: 28, role: 'user', bio: 'UX Designer', officeId: null },
  { name: 'Eve', email: 'eve@example.com', age: 30, role: 'manager', officeId: 2, bio: null },
  { name: 'Mallory', email: 'mallory@example.com', age: 40, role: 'user', officeId: 3, bio: 'Security Analyst, also a user' },
  { name: 'Trent', email: 'trent@example.com', age: null, role: 'user', officeId: 3, bio: 'Intern' },
  { name: 'Ursula User', email: 'ursula@example.com', age: 29, role: 'user', officeId: 1, bio: 'Another engineer' },
];

const samplePosts: Array<Omit<InsertPost, 'id'>> = [
  { title: 'Hello World', content: 'First post content', userId: 1, views: 100 },
  { title: 'SQLite Tips', content: 'Some tips for SQLite', userId: 1, views: 50 },
  { title: 'Product Updates', content: 'New features launched', userId: 2, views: 200 },
  { title: 'Data Analysis', content: 'Analyzing trends', userId: 3, views: 75 },
  { title: 'Unpublished Draft', content: 'Work in progress', userId: null, views: 0 },
  { title: 'Tech Deep Dive', content: 'Exploring advanced topics', userId: 1, views: 120 },
];

let db: BetterSQLite3Database;
let client: Database.Database;

let officeAdapter: Adapter<typeof officesTable, Office, InsertOffice>;
let userAdapter: Adapter<typeof usersTable, User, InsertUser>;
let postAdapter: Adapter<typeof postsTable, Post, InsertPost>;
let uniquePairAdapter: Adapter<typeof uniquePairTable, UniquePair, InsertUniquePair>;
let typedAdapter: Adapter<typeof typedTable, Typed, InsertTyped>;
let defaultsAdapter: Adapter<typeof defaultsTable, DefaultsRow, InsertDefaults>;

beforeAll(() => {
  client = new Database(':memory:');
  db = drizzle(client);
});

beforeEach(() => {
  client.exec(`
    DROP TABLE IF EXISTS posts;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS offices;
    DROP TABLE IF EXISTS no_id_table;
    DROP TABLE IF EXISTS unique_pair_table;
    DROP TABLE IF EXISTS typed_table;
    DROP TABLE IF EXISTS defaults_table;
    DROP TABLE IF EXISTS casing_table;

    CREATE TABLE offices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      location TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      age INTEGER,
      role TEXT DEFAULT 'user',
      office_id INTEGER,
      bio TEXT,
      FOREIGN KEY (office_id) REFERENCES offices(id) ON DELETE CASCADE
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      user_id INTEGER,
      views INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE no_id_table (pk_col INTEGER PRIMARY KEY, data TEXT);
    CREATE TABLE unique_pair_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      val_a TEXT,
      val_b TEXT,
      val_c TEXT,
      UNIQUE(val_a, val_b)
    );
    CREATE TABLE typed_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      occurred_at INTEGER,
      active INTEGER,
      payload BLOB,
      meta TEXT
    );
    CREATE TABLE casing_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key TEXT NOT NULL UNIQUE,
      display_name TEXT
    );
    CREATE TABLE defaults_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      a TEXT,
      b INTEGER DEFAULT 42
    );
  `);

  officeAdapter = Adapter(db, officesTable);
  userAdapter = Adapter(db, usersTable);
  postAdapter = Adapter(db, postsTable);
  uniquePairAdapter = Adapter(db, uniquePairTable);
  typedAdapter = Adapter(db, typedTable);
  defaultsAdapter = Adapter(db, defaultsTable);

  Effect.runSync(Effect.provideService(officeAdapter.insert(sampleOffices), SqliteClientTag, db));
  Effect.runSync(Effect.provideService(userAdapter.insert(sampleUsers), SqliteClientTag, db));
  Effect.runSync(Effect.provideService(postAdapter.insert(samplePosts), SqliteClientTag, db));
});

afterAll(() => {
  client.close();
});

const watchUpdatedColumns = (columns: ReadonlyArray<keyof User>): (() => string[]) => {
  client.exec('CREATE TABLE IF NOT EXISTS touch_log (col TEXT); DELETE FROM touch_log;');
  for (const column of columns) {
    const name = column === 'officeId' ? 'office_id' : column;
    client.exec(`CREATE TRIGGER touch_${name} AFTER UPDATE OF ${name} ON users BEGIN INSERT INTO touch_log VALUES ('${name}'); END;`);
  }

  return () => (client.prepare('SELECT col FROM touch_log ORDER BY col').all() as Array<{ col: string }>).map((row) => row.col);
};

describe('Adapter Initialization & Table Schema Validation', () => {
  it('instantiates successfully when provided a schema containing an "id" primary key column', () => {
    expect(() => Adapter(db, usersTable)).not.toThrow();
  });

  it('throws an explicit initialization error when the schema lacks an "id" primary key column', () => {
    const action = () => Adapter(db, noIdTable);
    expect(action).toThrow(/^Table "no_id_table" must have a primary key "id"\.?$/);
  });
});

describe('Filtering & Predicates', () => {
  describe('Basic Retrieval & Unconstrained Queries', () => {
    it.effect('returns all table rows with complete column payloads when no query arguments are provided', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find();
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(sampleUsers.length);
        const sampleUserKeys = Object.keys(usersTable);
        users.forEach((user) => {
          sampleUserKeys.forEach((key) => expect(user).toHaveProperty(key));
        });
      }),
    );

    it.effect('returns an empty array when executed against an unpopulated table', () =>
      Effect.gen(function* () {
        client.exec('DELETE FROM offices;');
        const offices = yield* officeAdapter.find();
        expectTypeOf(offices).toEqualTypeOf<Office[]>();
        expect(offices).toEqual([]);
      }),
    );

    it.effect('retrieves a single row wrapped in Option.some when matched', () =>
      Effect.gen(function* () {
        const aliceSample = sampleUsers.find((u) => u.email === 'alice@example.com')!;
        const foundUser = yield* userAdapter.findOne({ email: 'alice@example.com' });
        expectTypeOf(foundUser).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(foundUser)).toBe(true);
        expect(foundUser).toEqual(Option.some(expect.objectContaining({ name: aliceSample.name, email: aliceSample.email })));
      }),
    );

    it.effect('returns Option.none when no row satisfies the query filter', () =>
      Effect.gen(function* () {
        const foundUser = yield* userAdapter.findOne({ email: 'nonexistent@example.com' });
        expectTypeOf(foundUser).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isNone(foundUser)).toBe(true);
      }),
    );

    it.effect('returns Option.none when executing findOne against an empty table', () =>
      Effect.gen(function* () {
        client.exec('DELETE FROM users;');
        const foundUser = yield* userAdapter.findOne({ name: 'Alice' });
        expectTypeOf(foundUser).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isNone(foundUser)).toBe(true);
      }),
    );

    it.effect('computes total row count across the entire table when unconstrained', () =>
      Effect.gen(function* () {
        const count = yield* userAdapter.count();
        expectTypeOf(count).toEqualTypeOf<number>();
        expect(count).toBe(sampleUsers.length);
      }),
    );

    it.effect('computes row count matching specific filter criteria', () =>
      Effect.gen(function* () {
        const usersAge30Count = sampleUsers.filter((u) => u.age === 30).length;
        const count = yield* userAdapter.count({ age: 30 });
        expectTypeOf(count).toEqualTypeOf<number>();
        expect(count).toBe(usersAge30Count);
      }),
    );

    it.effect('returns zero count when no table rows satisfy the filter predicate', () =>
      Effect.gen(function* () {
        const count = yield* userAdapter.count({ name: 'NonExistentName' });
        expectTypeOf(count).toEqualTypeOf<number>();
        expect(count).toBe(0);
      }),
    );

    it.effect('returns zero count when executing against an unpopulated table', () =>
      Effect.gen(function* () {
        client.exec('DELETE FROM users;');
        const count = yield* userAdapter.count();
        expectTypeOf(count).toEqualTypeOf<number>();
        expect(count).toBe(0);
      }),
    );
  });

  describe('Equality & Null Comparison Predicates', () => {
    it.effect('filters rows matching an exact string equality condition', () =>
      Effect.gen(function* () {
        const aliceOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(aliceOpt));
        const alice = aliceOpt.value;
        const users = yield* userAdapter.find({ name: 'Alice' });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toEqual([expect.objectContaining({ id: alice.id, name: 'Alice' })]);
      }),
    );

    it.effect('filters rows matching an exact integer equality condition', () =>
      Effect.gen(function* () {
        const usersAge30 = sampleUsers.filter((u) => u.age === 30);
        const foundUsers = yield* userAdapter.find({ age: 30 });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersAge30.length);
        foundUsers.forEach((user) => expect(user.age).toBe(30));
      }),
    );

    it.effect('filters rows where a column value is explicitly null', () =>
      Effect.gen(function* () {
        const usersNullBio = sampleUsers.filter((u) => u.bio === null);
        const foundUsers = yield* userAdapter.find({ bio: null });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersNullBio.length);
        foundUsers.forEach((user) => expect(user.bio).toBeNull());
      }),
    );

    it.effect('filters rows where a column is null using explicit null check ($null: true)', () =>
      Effect.gen(function* () {
        const usersNullAgeCount = sampleUsers.filter((u) => u.age === null).length;
        const foundUsers = yield* userAdapter.find({ age: { $null: true } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersNullAgeCount);
        foundUsers.forEach((u) => expect(u.age).toBeNull());
      }),
    );

    it.effect('filters rows where a column is not null using explicit null check ($null: false)', () =>
      Effect.gen(function* () {
        const usersNonNullAgeCount = sampleUsers.filter((u) => u.age !== null).length;
        const foundUsers = yield* userAdapter.find({ age: { $null: false } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersNonNullAgeCount);
        foundUsers.forEach((u) => expect(u.age).not.toBeNull());
      }),
    );

    it.effect('enforces case-sensitive string comparison for exact equality', () =>
      Effect.gen(function* () {
        const usersLower = yield* userAdapter.find({ name: 'alice' });
        expectTypeOf(usersLower).toEqualTypeOf<User[]>();
        expect(usersLower.filter((u) => u.name === 'alice')).toHaveLength(0);

        const usersUpper = yield* userAdapter.find({ name: 'Alice' });
        expectTypeOf(usersUpper).toEqualTypeOf<User[]>();
        expect(usersUpper.filter((u) => u.name === 'Alice').length).toBeGreaterThan(0);
      }),
    );
  });

  describe('Scalar Comparison & Range Predicates ($gt, $gte, $lt, $lte, $ne)', () => {
    it.effect('filters rows where a column value does not match the scalar target ($ne)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $ne: 'Alice' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.every((u) => u.name !== 'Alice')).toBe(true);
        expect(users).toHaveLength(sampleUsers.length - 1);
      }),
    );

    it.effect('filters rows where a nullable column is not null using $ne', () =>
      Effect.gen(function* () {
        const usersNonNullBioCount = sampleUsers.filter((u) => u.bio !== null).length;
        const foundUsers = yield* userAdapter.find({ bio: { $ne: null } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersNonNullBioCount);
        foundUsers.forEach((user) => expect(user.bio).not.toBeNull());
      }),
    );

    it.effect('filters rows where a numeric column is strictly greater than the threshold ($gt)', () =>
      Effect.gen(function* () {
        const usersOlderThan30Count = sampleUsers.filter((u) => u.age !== null && u.age! > 30).length;
        const foundUsers = yield* userAdapter.find({ age: { $gt: 30 } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersOlderThan30Count);
        foundUsers.forEach((user) => expect(user.age).toBeGreaterThan(30));
      }),
    );

    it.effect('evaluates comparison against null ($gt: null) to an empty result set per SQLite three-valued logic', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ age: { $gt: null } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);

        const negated = yield* userAdapter.find({ $not: { age: { $gt: null } } });
        expectTypeOf(negated).toEqualTypeOf<User[]>();
        expect(negated).toHaveLength(0);
      }),
    );

    it.effect('filters rows where a numeric column is greater than or equal to the threshold ($gte)', () =>
      Effect.gen(function* () {
        const usersGte30Count = sampleUsers.filter((u) => u.age !== null && u.age! >= 30).length;
        const foundUsers = yield* userAdapter.find({ age: { $gte: 30 } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersGte30Count);
        foundUsers.forEach((user) => expect(user.age).toBeGreaterThanOrEqual(30));
      }),
    );

    it.effect('filters rows where a numeric column is strictly less than the threshold ($lt)', () =>
      Effect.gen(function* () {
        const usersYoungerThan30Count = sampleUsers.filter((u) => u.age !== null && u.age! < 30).length;
        const foundUsers = yield* userAdapter.find({ age: { $lt: 30 } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersYoungerThan30Count);
        foundUsers.forEach((user) => expect(user.age).toBeLessThan(30));
      }),
    );

    it.effect('filters rows where a numeric column is less than or equal to the threshold ($lte)', () =>
      Effect.gen(function* () {
        const usersLte30Count = sampleUsers.filter((u) => u.age !== null && u.age! <= 30).length;
        const foundUsers = yield* userAdapter.find({ age: { $lte: 30 } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersLte30Count);
        foundUsers.forEach((user) => expect(user.age).toBeLessThanOrEqual(30));
      }),
    );

    it.effect('evaluates $lt and $lte comparisons against null to empty results', () =>
      Effect.gen(function* () {
        const usersLt = yield* userAdapter.find({ age: { $lt: null } });
        expectTypeOf(usersLt).toEqualTypeOf<User[]>();
        expect(usersLt).toHaveLength(0);

        const usersLte = yield* userAdapter.find({ age: { $lte: null } });
        expectTypeOf(usersLte).toEqualTypeOf<User[]>();
        expect(usersLte).toHaveLength(0);

        const nested = yield* userAdapter.find({ age: { $not: { $lte: null } } });
        expectTypeOf(nested).toEqualTypeOf<User[]>();
        expect(nested).toHaveLength(0);
      }),
    );
  });

  describe('String Pattern Predicates ($like, $nlike, $glob, $nglob)', () => {
    it.effect('filters rows matching a SQL LIKE wildcard pattern ($like)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $like: 'A%' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.every((u) => u.name.startsWith('A'))).toBe(true);
        expect(users).toHaveLength(sampleUsers.filter((u) => u.name.startsWith('A')).length);
      }),
    );

    it.effect('filters rows excluding a SQL LIKE wildcard pattern ($nlike)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $nlike: 'A%' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.every((u) => !u.name.startsWith('A'))).toBe(true);
        expect(users).toHaveLength(sampleUsers.filter((u) => !u.name.startsWith('A')).length);
      }),
    );

    it.effect('filters rows matching a Unix glob pattern ($glob)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $glob: '*e' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        const names = users.map((u) => u.name);
        const expectedNames = sampleUsers.filter((u) => u.name.endsWith('e')).map((u) => u.name);
        expect(names.sort()).toEqual(expect.arrayContaining(expectedNames.sort()));
        expect(names).toHaveLength(expectedNames.length);
      }),
    );

    it.effect('filters rows excluding a Unix glob pattern ($nglob)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $nglob: '*e' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.every((u) => !u.name.endsWith('e'))).toBe(true);
        expect(users).toHaveLength(sampleUsers.filter((u) => !u.name.endsWith('e')).length);
      }),
    );

    it.effect('applies ASCII case-insensitivity during LIKE string pattern evaluation', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $like: 'aliCE%' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.some((u) => u.name === 'Alice')).toBe(true);
      }),
    );

    it.effect('enforces strict case-sensitivity during Unix GLOB wildcard evaluation', () =>
      Effect.gen(function* () {
        const usersSensitive = yield* userAdapter.find({ name: { $glob: 'A*' } });
        expectTypeOf(usersSensitive).toEqualTypeOf<User[]>();
        expect(usersSensitive.some((u) => u.name === 'Alice')).toBe(true);

        const usersSensitiveFail = yield* userAdapter.find({ name: { $glob: 'a*' } });
        expectTypeOf(usersSensitiveFail).toEqualTypeOf<User[]>();
        expect(usersSensitiveFail.some((u) => u.name === 'Alice')).toBe(false);
      }),
    );
  });

  describe('Set Inclusion Predicates ($in, $nin)', () => {
    it.effect('filters rows where a column matches any element in an array ($in)', () =>
      Effect.gen(function* () {
        const targetRoles = ['admin', 'manager'];
        const expectedUsersCount = sampleUsers.filter((u) => u.role !== null && targetRoles.includes(u.role!)).length;
        const foundUsers = yield* userAdapter.find({ role: { $in: targetRoles } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(expectedUsersCount);
        foundUsers.forEach((user) => expect(targetRoles).toContain(user.role));
      }),
    );

    it.effect('evaluates an empty array set inclusion ($in: []) to false and returns no rows', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ role: { $in: [] } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('filters rows where a column does not match any element in an array ($nin)', () =>
      Effect.gen(function* () {
        const excludedRoles = ['admin', 'manager'];
        const expectedUsersCount = sampleUsers.filter((u) => u.role !== null && !excludedRoles.includes(u.role!)).length;
        const foundUsers = yield* userAdapter.find({ role: { $nin: excludedRoles } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(expectedUsersCount);
        foundUsers.forEach((user) => expect(excludedRoles).not.toContain(user.role));
      }),
    );

    it.effect('evaluates an empty array set exclusion ($nin: []) to true and returns all rows', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ role: { $nin: [] } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(sampleUsers.length);
      }),
    );
  });

  describe('Logical Predicates ($and, $or, $not, $nand, $nor)', () => {
    it.effect('combines multiple filter predicates with logical conjunction ($and)', () =>
      Effect.gen(function* () {
        const bob = sampleUsers.find((u) => u.email === 'bob@example.com')!;
        const foundUsers = yield* userAdapter.find({ $and: [{ role: 'user' }, { age: 24 }] });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(1);
        expect(foundUsers[0]).toEqual(expect.objectContaining({ name: bob.name, email: bob.email }));
      }),
    );

    it.effect('evaluates an empty conjunction ($and: []) to true', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $and: [] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(sampleUsers.length);
      }),
    );

    it.effect('combines multiple filter predicates with logical disjunction ($or)', () =>
      Effect.gen(function* () {
        const expectedUsersCount = sampleUsers.filter((u) => u.role === 'admin' || (u.age !== null && u.age! < 25)).length;
        const users = yield* userAdapter.find({ $or: [{ role: 'admin' }, { age: { $lt: 25 } }] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(expectedUsersCount);
      }),
    );

    it.effect('evaluates an empty disjunction ($or: []) to false', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $or: [] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('negates a single filter predicate condition ($not)', () =>
      Effect.gen(function* () {
        const expectedUsersCount = sampleUsers.filter((u) => u.role !== 'admin').length;
        const users = yield* userAdapter.find({ $not: { role: 'admin' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(expectedUsersCount);
      }),
    );

    it.effect('excludes null values when negating an equality condition on a nullable column', () =>
      Effect.gen(function* () {
        const expectedUsers = sampleUsers.filter((u) => u.age !== null && u.age !== 30);
        const foundUsers = yield* userAdapter.find({ age: { $not: { $eq: 30 } } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(expectedUsers.length);
        foundUsers.forEach((u) => {
          expect(u.age).not.toBeNull();
          expect(u.age).not.toBe(30);
        });
      }),
    );

    it.effect('treats negated null equality ($not: { $eq: null }) as non-null check', () =>
      Effect.gen(function* () {
        const expectedUsers = sampleUsers.filter((u) => u.age !== null);
        const foundUsers = yield* userAdapter.find({ age: { $not: { $eq: null } } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(expectedUsers.length);
        foundUsers.forEach((u) => expect(u.age).not.toBeNull());

        const foundUsersNe = yield* userAdapter.find({ age: { $ne: null } });
        expect(foundUsersNe.map((u) => u.id).sort()).toEqual(foundUsers.map((u) => u.id).sort());
      }),
    );

    it.effect('evaluates negated conjunction ($nand) over predicate conditions', () =>
      Effect.gen(function* () {
        const expectedUsersCount = sampleUsers.filter((u) => {
          return u.age != null && !(u.role === 'user' && u.age === 30);
        }).length;
        const foundUsers = yield* userAdapter.find({ $nand: [{ role: 'user' }, { age: 30 }] });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(expectedUsersCount);
        foundUsers.forEach((u) => {
          expect(u.role === 'user' && u.age === 30).toBe(false);
        });
      }),
    );

    it.effect('evaluates an empty negated conjunction ($nand: []) to false', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $nand: [] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('evaluates negated disjunction ($nor) over predicate conditions', () =>
      Effect.gen(function* () {
        const expectedUsersCount = sampleUsers.filter((u) => {
          return u.age != null && !(u.role === 'admin' || u.age < 25);
        }).length;

        const users = yield* userAdapter.find({ $nor: [{ role: 'admin' }, { age: { $lt: 25 } }] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(expectedUsersCount);
      }),
    );

    it.effect('evaluates an empty negated disjunction ($nor: []) to true', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $nor: [] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(sampleUsers.length);
      }),
    );

    it.effect('resolves complex nested logical expression structures ($and inside $or)', () =>
      Effect.gen(function* () {
        const expectedUsers = sampleUsers.filter((u) => (u.role === 'admin' || (u.age != null && u.age < 25)) && u.officeId === 1);

        const foundUsers = yield* userAdapter.find({
          $and: [{ $or: [{ role: 'admin' }, { age: { $lt: 25 } }] }, { officeId: 1 }],
        });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(expectedUsers.length);
        if (expectedUsers.length > 0) {
          expect(foundUsers.map((u) => u.email).sort()).toEqual(expectedUsers.map((u) => u.email).sort());
        }
      }),
    );

    it.effect('computes row count for complex logical expression filters', () =>
      Effect.gen(function* () {
        const expectedCount = sampleUsers.filter((u) => u.role === 'user' && u.age != null && u.age < 30).length;
        const count = yield* userAdapter.count({ $and: [{ role: 'user' }, { age: { $lt: 30 } }] });
        expectTypeOf(count).toEqualTypeOf<number>();
        expect(count).toBe(expectedCount);
      }),
    );
  });

  describe('Three-Valued Logic & Degraded Predicates', () => {
    it.effect('retains valid truthy disjunction branches when sibling branch evaluates to UNKNOWN', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $or: [{ role: 'admin' }, { age: { $like: null } }] });
        expect(users.map((u) => u.role)).toEqual(['admin']);
      }),
    );

    it.effect('evaluates $nor containing UNKNOWN conditions to false', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $nor: [{ age: { $gte: null } }] });
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('evaluates empty $in/$nin arrays to deterministic boolean values', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ $not: { role: { $in: [] } } })).toHaveLength(sampleUsers.length);
        expect(yield* userAdapter.find({ $not: { role: { $nin: [] } } })).toHaveLength(0);
      }),
    );

    it.effect('filters non-null values when null is included inside $in array targets', () =>
      Effect.gen(function* () {
        const expected = sampleUsers.filter((u) => u.age === 30).length;
        const users = yield* userAdapter.find({ age: { $in: [30, null] } as never });
        expect(users).toHaveLength(expected);
        users.forEach((u) => expect(u.age).toBe(30));
      }),
    );

    it.effect('evaluates $nin containing null elements to false for all rows', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ age: { $nin: [30, null] } as never });
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('handles invalid non-array operands for $in/$nin gracefully', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ role: { $in: null } as never })).toHaveLength(0);
        expect(yield* userAdapter.find({ role: { $nin: null } as never })).toHaveLength(sampleUsers.length);
      }),
    );

    it.effect('evaluates unrecognized operator keys ($bogus) to false', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ role: { $bogus: 'user' } as never });
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('evaluates invalid non-object $not operands to false', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ $not: 'user' as never })).toHaveLength(0);
        expect(yield* userAdapter.find({ $not: [{ role: 'user' }] as never })).toHaveLength(0);
      }),
    );

    it.effect('treats empty objects inside logical conjunctions/disjunctions as true', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ $and: [{}] })).toHaveLength(sampleUsers.length);
        expect(yield* userAdapter.find({ $and: [{}, { role: 'admin' }] })).toHaveLength(1);
        expect(yield* userAdapter.find({ $or: [{}] })).toHaveLength(sampleUsers.length);
        expect(yield* userAdapter.find({ $or: [{ role: 'admin' }, {}] })).toHaveLength(sampleUsers.length);
        expect(yield* userAdapter.find({ $nand: [{}] })).toHaveLength(0);
        expect(yield* userAdapter.find({ $nor: [{}] })).toHaveLength(0);
        expect(yield* userAdapter.find({ $nor: [{ role: 'admin' }, {}] })).toHaveLength(0);
      }),
    );

    it.effect('treats filters consisting solely of undefined values as empty predicates', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ $or: [{ role: undefined }] })).toHaveLength(sampleUsers.length);
        expect(yield* userAdapter.find({ $and: [{ role: undefined }, { role: 'admin' }] })).toHaveLength(1);
      }),
    );

    it.effect('evaluates non-array operands for logical operators ($and/$or) to false', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ $and: { role: 'admin' } as never })).toHaveLength(0);
        expect(yield* userAdapter.find({ $or: { role: 'admin' } as never })).toHaveLength(0);
        expect(yield* userAdapter.find({ $nand: null as never })).toHaveLength(0);
        expect(yield* userAdapter.find({ $nor: 'nope' as never })).toHaveLength(0);
      }),
    );

    it.effect('evaluates non-object elements within logical operator arrays to false', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ $and: [null] as never })).toHaveLength(0);
        expect(yield* userAdapter.find({ $and: ['role'] as never })).toHaveLength(0);
        expect(yield* userAdapter.find({ $or: [{ role: 'admin' }, 5] as never })).toHaveLength(1);
      }),
    );

    it.effect('fails with SqliteClientError when unknown columns appear inside negated clauses', () =>
      Effect.gen(function* () {
        const direct = yield* Effect.exit(userAdapter.find({ nope: 'x' } as never));
        assert(Exit.isFailure(direct));
        expect((Option.getOrThrow(Cause.failureOption(direct.cause)) as SqliteClientError).message).toMatch(/Unknown column "nope"/);

        const negated = yield* Effect.exit(userAdapter.find({ $not: { nope: 'x' } } as never));
        assert(Exit.isFailure(negated));
        expect((Option.getOrThrow(Cause.failureOption(negated.cause)) as SqliteClientError).message).toMatch(/Unknown column "nope"/);
      }),
    );

    it.effect('rejects Object.prototype property keys as invalid unknown columns', () =>
      Effect.gen(function* () {
        for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
          const exit = yield* Effect.exit(userAdapter.find({ [key]: 'x' } as never));
          assert(Exit.isFailure(exit));
          const failure = Cause.failureOption(exit.cause);
          assert(Option.isSome(failure));
          expect(failure.value).toBeInstanceOf(SqliteClientError);
          expect((failure.value as SqliteClientError).message).toMatch(/Unknown column/);
        }

        const orderExit = yield* Effect.exit(userAdapter.find({}, { order: { constructor: 'asc' } as never }));
        assert(Exit.isFailure(orderExit));
        expect((Option.getOrThrow(Cause.failureOption(orderExit.cause)) as SqliteClientError).message).toMatch(/Unknown column/);

        expect(Object.keys((yield* userAdapter.find({}, { select: { constructor: 1 } as never }))[0])).toEqual(['id']);
      }),
    );

    it.effect('evaluates Object.prototype keys inside operator objects to false', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ role: { $eq: 'admin', constructor: 'x' } as never })).toHaveLength(0);
        expect(yield* userAdapter.find({ role: { $bogus: 'admin', toString: 'x' } as never })).toHaveLength(0);
      }),
    );

    it.effect('coerces $null values to boolean flags and handles null operands', () =>
      Effect.gen(function* () {
        const nullBio = sampleUsers.filter((u) => u.bio === null).length;
        expect(yield* userAdapter.find({ bio: { $null: 'yes' as never } })).toHaveLength(nullBio);
        expect(yield* userAdapter.find({ bio: { $null: '' as never } })).toHaveLength(sampleUsers.length - nullBio);
        expect(yield* userAdapter.find({ bio: { $null: null as never } })).toHaveLength(sampleUsers.length - nullBio);
      }),
    );

    it.effect('evaluates negation of an empty filter ($not: {}) to false', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ $not: {} })).toHaveLength(0);
        expect(yield* userAdapter.find({ $not: { role: undefined } })).toHaveLength(0);
      }),
    );

    it.effect('ignores undefined field filter properties instead of binding SQL NULL', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ role: undefined });
        expect(users).toHaveLength(sampleUsers.length);

        const scoped = yield* userAdapter.find({ role: 'admin', age: undefined });
        expect(scoped).toHaveLength(1);
      }),
    );

    it.effect('ignores undefined operator values ($eq: undefined) treating field as unconstrained', () =>
      Effect.gen(function* () {
        const byField = yield* userAdapter.find({ age: undefined });
        const byOperator = yield* userAdapter.find({ age: { $eq: undefined } });

        expect(byOperator).toHaveLength(sampleUsers.length);
        expect(byOperator).toEqual(byField);
      }),
    );

    it.effect('drops undefined operator keys while applying defined sibling operator conditions', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ age: { $gt: undefined, $lt: 30 } }, { order: { name: 'asc' } });
        const expected = sampleUsers.filter((u) => u.age != null && u.age < 30).length;

        expect(users).toHaveLength(expected);
        expect(users.every((u) => u.age! < 30)).toBe(true);
      }),
    );

    it.effect('treats undefined operator arguments as absent across all operator types', () =>
      Effect.gen(function* () {
        const filters = [
          { bio: { $null: undefined } },
          { role: { $in: undefined } },
          { role: { $nin: undefined } },
          { role: { $not: undefined } },
          { name: { $like: undefined } },
          { name: { $glob: undefined } },
        ];

        for (const filter of filters) {
          expect(yield* userAdapter.find(filter as never)).toHaveLength(sampleUsers.length);
        }
      }),
    );

    it.effect('leaves column unconstrained when operator object contains only undefined values', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ role: 'user', age: { $gte: undefined, $lte: undefined } });
        const expected = sampleUsers.filter((u) => u.role === 'user').length;

        expect(users).toHaveLength(expected);
      }),
    );

    it.effect('evaluates $not containing only undefined operands to false', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.find({ $not: { age: { $gt: undefined } } })).toHaveLength(0);
      }),
    );

    it.effect('fails with a SqliteClientError when querying against an unmapped table column', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.find({ unknownColumn: 'test' } as unknown as Partial<User>));
        assert(Exit.isFailure(exit));
        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        expect(failure.value).toBeInstanceOf(SqliteClientError);
        expect((failure.value as SqliteClientError).message).toMatch(/Unknown column "unknownColumn"/);
      }),
    );
  });
});

describe('Ordering & Pagination', () => {
  describe('Limit and Offset Options', () => {
    it.effect('restricts maximum returned row count according to the limit option', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { limit: 2 });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(2);
      }),
    );

    it.effect('returns an empty array when limit is set to zero', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { limit: 0 });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('returns all matching records when limit is a negative integer', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { limit: -1 });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(8);
      }),
    );

    it.effect('bypasses the initial N records according to the offset option', () =>
      Effect.gen(function* () {
        const allUsers = yield* userAdapter.find({}, { order: { id: 'asc' } });

        const offset = 2;
        const users = yield* userAdapter.find({}, { offset, order: { id: 'asc' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(sampleUsers.length - offset);
        if (allUsers.length > offset && users.length > 0) {
          expect(users[0].id).toBe(allUsers[offset].id);
        }
      }),
    );

    it.effect('returns an empty array when offset exceeds total row count', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { offset: 1000 });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('combines limit and offset parameters to paginate result windows', () =>
      Effect.gen(function* () {
        const allUsers = yield* userAdapter.find({}, { order: { id: 'asc' } });

        const limit = 2;
        const offset = 1;
        const users = yield* userAdapter.find({}, { limit, offset, order: { id: 'asc' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(limit);
        if (allUsers.length >= offset + limit && users.length > 0) {
          expect(users[0].id).toBe(allUsers[offset].id);
          expect(users[users.length - 1].id).toBe(allUsers[offset + limit - 1].id);
        }
      }),
    );

    it.effect('executes offset pagination without explicit limit constraint', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { offset: 3, order: { id: 'asc' } });
        expect(users).toHaveLength(sampleUsers.length - 3);
      }),
    );

    it.effect('interprets negative limit values as unconstrained limit with offset', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { limit: -1, offset: 6, order: { id: 'asc' } });
        expect(users).toHaveLength(sampleUsers.length - 6);
      }),
    );

    it.effect('treats offset 0 as a no-op returning full query result set', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { offset: 0 });
        expect(users).toHaveLength(sampleUsers.length);
      }),
    );

    it.effect('emits standard SQL LIMIT/OFFSET clauses on raw Drizzle database instances', () =>
      Effect.gen(function* () {
        const raw = drizzle(client);
        const adapter = Adapter(raw, usersTable);

        expect(yield* adapter.find({}, { offset: 2, order: { id: 'asc' } })).toHaveLength(sampleUsers.length - 2);
        expect(yield* adapter.find({}, { limit: -1 })).toHaveLength(sampleUsers.length);
        expect(yield* adapter.find({}, { limit: 2 })).toHaveLength(2);
      }),
    );

    it.effect('fails fast with SqliteClientError when limit is a non-integer float', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.find({}, { limit: 2.5 }));
        assert(Exit.isFailure(exit));
        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        expect((failure.value as SqliteClientError).message).toMatch(/Query option "limit" must be an integer/i);
      }),
    );

    it.effect('fails fast with SqliteClientError when limit is NaN', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.find({}, { limit: Number.NaN }));
        assert(Exit.isFailure(exit));
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/Query option "limit" must be an integer/i);
      }),
    );

    it.effect('fails fast with SqliteClientError when offset is a non-integer float', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.find({}, { offset: 1.5 }));
        assert(Exit.isFailure(exit));
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/Query option "offset" must be an integer/i);
      }),
    );

    it.effect('clamps negative offset values to zero', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { offset: -5, order: { id: 'asc' } });
        expect(users).toHaveLength(sampleUsers.length);
      }),
    );
  });

  describe('Sorting and Ordering Options', () => {
    it.effect('orders matching records by a string field in ascending sequence', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { order: { name: 'asc' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        for (let i = 0; i < users.length - 1; i++) {
          expect(users[i].name.localeCompare(users[i + 1].name)).toBeLessThanOrEqual(0);
        }
      }),
    );

    it.effect('orders matching records by a numeric field descending with nulls ordered last', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { order: { age: 'desc' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        let nullsStarted = false;
        for (let i = 0; i < users.length; i++) {
          const currentAge = users[i].age;
          if (currentAge === null) {
            nullsStarted = true;
          } else {
            expect(nullsStarted).toBe(false);
            if (i + 1 < users.length) {
              const nextAge = users[i + 1].age;
              if (nextAge !== null) {
                expect(currentAge).toBeGreaterThanOrEqual(nextAge);
              }
            }
          }
        }
      }),
    );

    it.effect('orders matching records by a numeric field ascending with nulls ordered first', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { order: { age: 'asc' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        let nonNullsStarted = false;
        for (let i = 0; i < users.length; i++) {
          const currentAge = users[i].age;
          if (currentAge !== null) {
            nonNullsStarted = true;
            if (i + 1 < users.length) {
              const nextAge = users[i + 1].age;
              if (nextAge !== null) {
                expect(currentAge).toBeLessThanOrEqual(nextAge);
              } else {
                expect(false).toBe(true);
              }
            }
          } else {
            expect(nonNullsStarted).toBe(false);
          }
        }
      }),
    );

    it.effect('applies multi-column sorting rules in sequence', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { order: { role: 'asc', name: 'desc' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();

        const allUsersFromDB = yield* userAdapter.find();

        const sortedManually = [...allUsersFromDB].sort((a, b) => {
          const roleA = a.role ?? '';
          const roleB = b.role ?? '';
          const roleCompare = roleA.localeCompare(roleB);
          if (roleCompare !== 0) {
            return roleCompare;
          }
          return b.name.localeCompare(a.name);
        });
        expect(users.map((u) => u.id)).toEqual(sortedManually.map((u) => u.id));
      }),
    );

    it.effect('selects the deterministic first row according to order specifications', () =>
      Effect.gen(function* () {
        const usersAge30 = yield* userAdapter.find({ age: 30 }, { order: { id: 'asc' } });
        expect(usersAge30.length).toBeGreaterThan(0);

        const minIdAge30 = usersAge30[0].id;
        const maxIdAge30 = usersAge30[usersAge30.length - 1].id;

        const userAsc = yield* userAdapter.findOne({ age: 30 }, { order: { id: 'asc' } });
        expectTypeOf(userAsc).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(userAsc)).toBe(true);
        if (Option.isSome(userAsc)) {
          expect(userAsc.value.id).toBe(minIdAge30);
        }

        const userDesc = yield* userAdapter.findOne({ age: 30 }, { order: { id: 'desc' } });
        expectTypeOf(userDesc).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(userDesc)).toBe(true);
        if (Option.isSome(userDesc)) {
          expect(userDesc.value.id).toBe(maxIdAge30);
        }
      }),
    );

    it.effect('fails with a SqliteClientError when ordering by an unmapped table column', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.find({}, { order: { nope: 'asc' } as never }));
        assert(Exit.isFailure(exit));
        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        expect(failure.value).toBeInstanceOf(SqliteClientError);
        expect((failure.value as SqliteClientError).message).toMatch(/Unknown column "nope"/);
        expect(() => client.prepare('SELECT * FROM users ORDER BY nope')).toThrow(/no such column/i);
      }),
    );
  });
});

describe('Projections & Selections', () => {
  describe('Inclusion and Exclusion Projections', () => {
    it.effect('includes only specified columns and primary key when using inclusion select', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { select: { name: 1, email: 1 } });
        expectTypeOf(users).toEqualTypeOf<Array<{ id: number; name: string; email: string | null }>>();
        expect(users.length).toBeGreaterThan(0);
        users.forEach((user) => {
          expect(Object.keys(user).sort()).toEqual(['id', 'name', 'email'].sort());
          expect(user).toHaveProperty('id');
          expect(user).toHaveProperty('name');
          expect(user).toHaveProperty('email');
        });
      }),
    );

    it.effect('excludes specified columns while retaining remaining schema fields', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { select: { name: 1, email: 1, bio: 0 } });
        expectTypeOf(users).toEqualTypeOf<Array<{ id: number; name: string; email: string | null }>>();
        expect(users.length).toBeGreaterThan(0);
        users.forEach((user) => {
          expect(Object.keys(user).sort()).toEqual(['id', 'name', 'email'].sort());
          expect(user).not.toHaveProperty('bio');
        });
      }),
    );

    it.effect('omits primary key "id" when explicitly marked for exclusion in select', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { select: { id: 0, name: 1 } });
        expectTypeOf(users).toEqualTypeOf<Array<{ name: string }>>();
        expect(users.length).toBeGreaterThan(0);
        users.forEach((user) => {
          expect(Object.keys(user).sort()).toEqual(['name'].sort());
          expect(user).not.toHaveProperty('id');
        });
      }),
    );

    it.effect('returns all default table columns when provided an empty select object', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { select: {} });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.length).toBeGreaterThan(0);
        const sampleUserKeys = Object.keys(usersTable);
        users.forEach((user) => {
          sampleUserKeys.forEach((key) => expect(user).toHaveProperty(key));
          expect(Object.keys(user).length).toBe(sampleUserKeys.length);
        });
      }),
    );

    it.effect('correctly projects TypeScript types for inclusion, exclusion, and mutation return aliases', () =>
      Effect.gen(function* () {
        const excluded = yield* userAdapter.find({}, { select: { bio: 0 } });
        expectTypeOf(excluded).toEqualTypeOf<Array<Omit<User, 'bio'>>>();

        const excludedId = yield* userAdapter.find({}, { select: { id: 0, bio: 0 } });
        expectTypeOf(excludedId).toEqualTypeOf<Array<Omit<User, 'id' | 'bio'>>>();

        const included = yield* userAdapter.find({}, { select: { name: 1 } });
        expectTypeOf(included).toEqualTypeOf<Array<{ id: number; name: string }>>();

        const includedNoId = yield* userAdapter.find({}, { select: { id: 0, name: 1 } });
        expectTypeOf(includedNoId).toEqualTypeOf<Array<{ name: string }>>();

        const updated = yield* userAdapter.update({ id: 1, name: 'x' } as User, { select: { name: 1 } });
        expectTypeOf(updated).toEqualTypeOf<Array<{ id: number; name: string }>>();

        const inserted = yield* userAdapter.insert({ name: 'x', email: 'x@e.com' }, { select: { id: 1 } });
        expectTypeOf(inserted).toEqualTypeOf<Array<{ id: number }>>();

        const deleted = yield* userAdapter.delete({ id: 1 } as User, { select: { id: 1, name: 1 } });
        expectTypeOf(deleted).toEqualTypeOf<Array<{ id: number; name: string }>>();

        const updatedOne = yield* userAdapter.findOneAndUpdate({ id: 1 } as User, { name: 'x' }, { select: { name: 1 } });
        expectTypeOf(updatedOne).toEqualTypeOf<Option.Option<{ id: number; name: string }>>();

        const deletedOne = yield* userAdapter.findOneAndDelete({ id: 1 } as User, { select: { name: 1 } });
        expectTypeOf(deletedOne).toEqualTypeOf<Option.Option<{ id: number; name: string }>>();
      }),
    );

    it.effect('allows primary key exclusion alongside joined table field selections', () =>
      Effect.gen(function* () {
        const items = yield* userAdapter.find(
          { email: 'alice@example.com' },
          {
            joins: [
              { table: officesTable, on: { officeId: 'id' }, type: 'left' },
              { table: postsTable, on: { id: 'userId' }, type: 'left' },
            ],
            select: { id: 0, name: 1, location: 1 },
          },
        );
        expectTypeOf(items).toEqualTypeOf<Array<{ name: string; location: string | null }>>();
        expect(items).toHaveLength(3);
        expect(items[0]).toEqual({ name: 'Alice', location: 'New York' });
        expect(Object.keys(items[0]).sort()).toEqual(['location', 'name'].sort());
      }),
    );

    it.effect('applies field selection projections to single-row option lookups', () =>
      Effect.gen(function* () {
        const aliceSample = sampleUsers.find((u) => u.email === 'alice@example.com')!;
        const user = yield* userAdapter.findOne({ email: 'alice@example.com' }, { select: { name: 1 } });
        assert(Option.isSome(user));
        expectTypeOf(user.value).toEqualTypeOf<{ id: number; name: string }>();
        expect(Option.isSome(user)).toBe(true);
        expect(user).toEqual(Option.some({ id: expect.any(Number), name: aliceSample.name }));
        expect(Object.keys(user.value).sort()).toEqual(['id', 'name'].sort());
      }),
    );

    it.effect('treats undefined projection flags as unflagged schema fields', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ email: 'alice@example.com' }, { select: { id: undefined, name: 1 } });
        expect(Object.keys(users[0]).sort()).toEqual(['id', 'name']);
      }),
    );

    it.effect('supports primary-key-only inclusion select projections', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ email: 'alice@example.com' }, { select: { id: 1 } });
        expect(Object.keys(users[0])).toEqual(['id']);
      }),
    );

    it.effect('applies selection projections across findOne and findOneAndDelete operations', () =>
      Effect.gen(function* () {
        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' }, { select: { name: 1 } });
        assert(Option.isSome(alice));
        expect(Object.keys(alice.value).sort()).toEqual(['id', 'name']);

        const deleted = yield* userAdapter.findOneAndDelete({ email: 'alice@example.com' }, { select: { id: 0, name: 1 } });
        assert(Option.isSome(deleted));
        expect(Object.keys(deleted.value)).toEqual(['name']);
      }),
    );

    it.effect('retains all unmentioned schema columns when using exclusion select', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ email: 'alice@example.com' }, { select: { bio: 0 } });
        expectTypeOf(users).toEqualTypeOf<Array<Omit<User, 'bio'>>>();
        expect(Object.keys(users[0])).toEqual(['id', 'name', 'email', 'age', 'role', 'officeId']);
      }),
    );

    it.effect('drops primary key "id" when explicitly marked for exclusion', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ email: 'alice@example.com' }, { select: { id: 0 } });
        expectTypeOf(users).toEqualTypeOf<Array<Omit<User, 'id'>>>();
        expect(Object.keys(users[0])).toEqual(['name', 'email', 'age', 'role', 'officeId', 'bio']);
      }),
    );

    it.effect('prioritizes inclusion flags over exclusion flags in mixed projections', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ email: 'alice@example.com' }, { select: { name: 1, bio: 0, age: 0 } });
        expect(Object.keys(users[0]).sort()).toEqual(['id', 'name']);
      }),
    );

    it.effect('treats all-undefined projection objects as default full-schema lookups', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ email: 'alice@example.com' }, { select: { bio: undefined } });
        expect(Object.keys(users[0])).toEqual(Object.keys(usersTable));
      }),
    );

    it.effect('ignores non-existent schema column keys inside selection projections', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ email: 'alice@example.com' }, { select: { nope: 1, name: 1 } as never });
        expect(Object.keys(users[0]).sort()).toEqual(['id', 'name']);
      }),
    );

    it.effect('applies exclusion select projections to insert, update, and delete return values', () =>
      Effect.gen(function* () {
        const inserted = yield* userAdapter.insert({ name: 'Proj', email: 'proj@example.com' }, { select: { bio: 0, officeId: 0 } });
        expect(Object.keys(inserted[0])).toEqual(['id', 'name', 'email', 'age', 'role']);

        const updated = yield* userAdapter.update({ ...(inserted[0] as User), age: 41 }, { select: { email: 0 } });
        expect(Object.keys(updated[0])).toEqual(['id', 'name', 'age', 'role', 'officeId', 'bio']);

        const deleted = yield* userAdapter.delete({ id: inserted[0].id } as User, { select: { id: 0, name: 1 } });
        expect(Object.keys(deleted[0])).toEqual(['name']);
      }),
    );
  });

  describe('Degenerate Projections and Validation', () => {
    const dropAll = { id: 0, name: 0, email: 0, age: 0, role: 0, officeId: 0, bio: 0 } as const;

    it.effect('fails with SqliteClientError when exclusion projection drops all schema columns', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.find({}, { select: dropAll }));
        assert(Exit.isFailure(exit));
        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        expect(failure.value).toBeInstanceOf(SqliteClientError);
        expect((failure.value as SqliteClientError).message).toMatch(/must keep at least one column/i);
      }),
    );

    it.effect('fails with SqliteClientError when inclusion projection specifies only unknown columns', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.find({}, { select: { id: 0, nope: 1 } as never }));
        assert(Exit.isFailure(exit));
        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        expect((failure.value as SqliteClientError).message).toMatch(/must keep at least one column/i);
      }),
    );

    it.effect('rejects degenerate all-excluded projections across insert, update, and delete write operations', () =>
      Effect.gen(function* () {
        const insertExit = yield* Effect.exit(userAdapter.insert({ name: 'Zed', email: 'zed@example.com' }, { select: dropAll }));
        assert(Exit.isFailure(insertExit));

        const updateExit = yield* Effect.exit(userAdapter.update({ id: 1, name: 'Zed' } as User, { select: dropAll }));
        assert(Exit.isFailure(updateExit));

        const deleteExit = yield* Effect.exit(userAdapter.delete({ id: 1 } as User, { select: dropAll }));
        assert(Exit.isFailure(deleteExit));

        const findOneExit = yield* Effect.exit(userAdapter.findOne({}, { select: dropAll }));
        assert(Exit.isFailure(findOneExit));

        const deleteOneExit = yield* Effect.exit(userAdapter.findOneAndDelete({}, { select: dropAll }));
        assert(Exit.isFailure(deleteOneExit));

        expect(yield* userAdapter.count()).toBe(sampleUsers.length);
        expect(yield* userAdapter.count({ name: 'Zed' })).toBe(0);
      }),
    );

    it.effect('allows dropping primary table columns if joined table columns are projected', () =>
      Effect.gen(function* () {
        const rows = yield* userAdapter.find(
          { name: 'Alice' },
          {
            joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'inner' }],
            select: { ...dropAll, location: 1 },
          },
        );

        expect(rows).toEqual([{ location: 'New York' }]);
      }),
    );
  });
});

describe('Relational Joins', () => {
  describe('Join Types (Inner, Left, Right, Full, Cross)', () => {
    it.effect('performs an inner join returning matching records from both tables', () =>
      Effect.gen(function* () {
        const joinedResult = yield* userAdapter.find(
          {},
          {
            joins: [{ table: officesTable, on: { officeId: 'id' } }],
          },
        );
        expectTypeOf(joinedResult).toEqualTypeOf<Array<{ users: User; offices: Office }>>;
        const usersWithOfficeInSample = sampleUsers.filter((u) => u.officeId !== null);
        expect(joinedResult).toHaveLength(usersWithOfficeInSample.length);
        joinedResult.forEach((item) => {
          expect(item.users).toBeDefined();
          expect(item.offices).toBeDefined();
          expect(item.users.officeId).toBe(item.offices.id);
        });
      }),
    );

    it.effect('performs a left outer join retaining left rows and null-filling missing right rows', () =>
      Effect.gen(function* () {
        const joinedResult = yield* userAdapter.find(
          {},
          {
            joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'left' }],
          },
        );
        expectTypeOf(joinedResult).toEqualTypeOf<Array<{ users: User; offices: Office | null }>>;
        expect(joinedResult).toHaveLength(sampleUsers.length);

        const davidInResult = joinedResult.find((r) => r.users.email === 'david@example.com');
        expect(davidInResult).toBeDefined();
        expect(davidInResult!.users.officeId).toBeNull();
        expect(davidInResult!.offices).toBeNull();

        const aliceInResult = joinedResult.find((r) => r.users.email === 'alice@example.com');
        expect(aliceInResult).toBeDefined();
        expect(aliceInResult!.offices).not.toBeNull();
        expect(aliceInResult!.users.officeId).toBe(aliceInResult!.offices!.id);
      }),
    );

    it.effect('emulates a right outer join retaining right rows and null-filling left rows', () =>
      Effect.gen(function* () {
        const joinedResult = yield* userAdapter.find(
          {},
          {
            joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'right' }],
          },
        );

        expectTypeOf(joinedResult).toEqualTypeOf<Array<{ users: User | null; offices: Office }>>;
        const officeIdsInResult = new Set(
          joinedResult.map((item) => item.offices?.id).filter((id?: number | null): id is number => id !== undefined && id !== null),
        );
        expect(officeIdsInResult.size).toBe(sampleOffices.length);

        const hqOfficeId = sampleOffices.findIndex((o) => o.name === 'HQ') + 1;
        const usersInHQCount = sampleUsers.filter((u) => u.officeId === hqOfficeId).length;
        const hqResults = joinedResult.filter((item) => item.offices?.id === hqOfficeId);

        expect(hqResults.length).toBe(usersInHQCount > 0 ? usersInHQCount : 1);

        const remoteHubResult = joinedResult.find((item) => item.offices?.name === 'Remote Hub');
        expect(remoteHubResult).toBeDefined();
        expect(remoteHubResult!.offices.name).toBe('Remote Hub');
        expect(remoteHubResult!.users).toBeNull();
      }),
    );

    it.effect('emulates a full outer join returning all records from both left and right relations', () =>
      Effect.gen(function* () {
        const joinedResult = yield* userAdapter.find(
          {},
          {
            joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'full' }],
          },
        );

        expectTypeOf(joinedResult).toEqualTypeOf<Array<{ users: User | null; offices: Office | null }>>;
        const davidInResult = joinedResult.find((r) => r.users?.email === 'david@example.com');
        expect(davidInResult).toBeDefined();
        expect(davidInResult?.users).toBeDefined();
        expect(davidInResult?.offices).toBeNull();

        const remoteHubInResult = joinedResult.find((r) => r.offices?.name === 'Remote Hub');
        expect(remoteHubInResult).toBeDefined();
        expect(remoteHubInResult?.offices).toBeDefined();
        expect(remoteHubInResult?.users).toBeNull();

        const usersCount = sampleUsers.length;
        const officesCount = sampleOffices.length;
        const uniqueUserIds = new Set(joinedResult.map((r) => r.users?.id).filter((id?: number | null): id is number => id != null));
        const uniqueOfficeIds = new Set(joinedResult.map((r) => r.offices?.id).filter((id?: number | null): id is number => id != null));

        expect(uniqueUserIds.size).toBe(usersCount);
        expect(uniqueOfficeIds.size).toBe(officesCount);
        expect(joinedResult.length).toBeGreaterThanOrEqual(Math.max(usersCount, officesCount));
      }),
    );

    it.effect('performs a cross join computing the Cartesian product of involved tables', () =>
      Effect.gen(function* () {
        const joinedResult = yield* userAdapter.find(
          {},
          {
            joins: [{ table: officesTable, on: {}, type: 'cross' }],
            limit: 50,
          },
        );

        expectTypeOf(joinedResult).toEqualTypeOf<Array<{ users: User; offices: Office }>>;
        const expectedCrossJoinLength = sampleUsers.length * sampleOffices.length;
        expect(joinedResult.length).toBe(Math.min(expectedCrossJoinLength, 50));

        if (joinedResult.length > 0) {
          expect(joinedResult[0].users).toBeDefined();
          expect(joinedResult[0].offices).toBeDefined();
          expect(joinedResult[0].users).toHaveProperty('id');
          expect(joinedResult[0].offices).toHaveProperty('id');
        }
      }),
    );

    it.effect('retrieves a single joined row structure wrapped in Option.some', () =>
      Effect.gen(function* () {
        const aliceSample = sampleUsers.find((u) => u.email === 'alice@example.com')!;
        const joinedResult = yield* userAdapter.findOne(
          { email: aliceSample.email },
          {
            joins: [{ table: officesTable, on: { officeId: 'id' } }],
          },
        );
        expect(Option.isSome(joinedResult)).toBe(true);
        if (Option.isSome(joinedResult)) {
          expect(joinedResult.value.users.email).toBe(aliceSample.email);
          expect(joinedResult.value.offices.name).toBe(sampleOffices.find((o) => o.name === 'HQ')!.name);
        }
      }),
    );
  });

  describe('Relational Filtering & Column Resolution', () => {
    it.effect('applies field selection across joined tables', () =>
      Effect.gen(function* () {
        const items = yield* userAdapter.find(
          {},
          {
            joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'left' }],
            select: { name: 1, id: 1, location: 1 },
          },
        );
        expectTypeOf(items).toEqualTypeOf<Array<{ id: number; name: string; location: string | null }>>();
        expect(items.length).toBeGreaterThan(0);
        items.forEach((item) => {
          expect(Object.keys(item).sort()).toEqual(['id', 'location', 'name'].sort());
        });
        expect(items.find((item) => item.name === 'Alice')).toBeDefined();
        expect(items.find((item) => item.name === 'David')).toBeDefined();
      }),
    );

    it.effect('applies primary table filter predicates to joined queries', () =>
      Effect.gen(function* () {
        const alice = sampleUsers.find((u) => u.email === 'alice@example.com')!;
        const joinedResult = yield* userAdapter.find(
          { role: 'admin' },
          {
            joins: [{ table: officesTable, on: { officeId: 'id' } }],
          },
        );
        expectTypeOf(joinedResult).toEqualTypeOf<Array<{ users: User; offices: Office }>>;
        expect(joinedResult).toHaveLength(1);
        const aliceFromDbOpt = yield* userAdapter.findOne({ email: alice.email });
        assert(Option.isSome(aliceFromDbOpt));
        const aliceFromDb = aliceFromDbOpt.value;

        expect(joinedResult[0].users.id).toBe(aliceFromDb.id);
        expect(joinedResult[0].offices.name).toBe('HQ');
      }),
    );

    it.effect('filters joined queries using primary table foreign key equality', () =>
      Effect.gen(function* () {
        const hqOfficeOpt = yield* officeAdapter.findOne({ name: 'HQ' });
        assert(Option.isSome(hqOfficeOpt), 'Expected HQ office to be found');
        const hqOffice = hqOfficeOpt.value;

        const usersInHQCount = sampleUsers.filter((u) => u.officeId === hqOffice.id).length;

        const joinedResult = yield* userAdapter.find(
          { officeId: hqOffice.id },
          {
            joins: [{ table: officesTable, on: { officeId: 'id' } }],
          },
        );
        expectTypeOf(joinedResult).toEqualTypeOf<Array<{ users: User; offices: Office }>>;
        expect(joinedResult).toHaveLength(usersInHQCount);
        joinedResult.forEach((item) => {
          expect(item.offices.name).toBe('HQ');
          expect(item.users.officeId).toBe(hqOffice!.id);
        });
      }),
    );

    it.effect('filters joined queries using secondary table column predicates', () =>
      Effect.gen(function* () {
        const joined = yield* userAdapter.find({ location: 'New York' } as never, {
          joins: [{ table: officesTable, on: { officeId: 'id' } }],
        });

        const expected = sampleUsers.filter((u) => u.officeId === 1).length;
        expect(joined).toHaveLength(expected);
        joined.forEach((item) => expect(item.offices.location).toBe('New York'));
      }),
    );

    it.effect('resolves ambiguous column names to primary table when present in both relations', () =>
      Effect.gen(function* () {
        const joined = yield* userAdapter.find(
          { name: 'Alice' },
          {
            joins: [{ table: officesTable, on: { officeId: 'id' } }],
          },
        );

        expect(joined).toHaveLength(1);
        expect(joined[0].users.name).toBe('Alice');
        expect(joined[0].offices.name).toBe('HQ');

        const projected = yield* userAdapter.find(
          { email: 'alice@example.com' },
          { joins: [{ table: officesTable, on: { officeId: 'id' } }], select: { name: 1 } },
        );
        expect(projected).toEqual([{ id: expect.any(Number), name: 'Alice' }]);
      }),
    );

    it.effect('orders joined result sets by a secondary table column', () =>
      Effect.gen(function* () {
        const items = yield* userAdapter.find(
          {},
          {
            joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'left' }],
            select: { name: 1, location: 1, id: 1 },
            order: { location: 'asc' },
          },
        );
        expectTypeOf(items).toEqualTypeOf<Array<{ id: number; name: string; location: string | null }>>();

        let nonNullsStarted = false;
        for (let i = 0; i < items.length; i++) {
          const currentLocation = items[i].location;
          if (currentLocation !== null) {
            nonNullsStarted = true;
            if (i + 1 < items.length) {
              const nextLocation = items[i + 1].location;
              if (nextLocation !== null) {
                expect(currentLocation.localeCompare(nextLocation)).toBeLessThanOrEqual(0);
              } else {
                expect(false).toBe(true);
              }
            }
          } else {
            expect(nonNullsStarted).toBe(false);
          }
        }
      }),
    );

    it.effect('maintains isolated column maps for distinct join query configurations', () =>
      Effect.gen(function* () {
        const withOffices = yield* userAdapter.find(
          { name: 'Alice' },
          { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'inner' }], select: { name: 1, location: 1 } },
        );
        expect(withOffices).toEqual([{ id: 1, name: 'Alice', location: 'New York' }]);

        const withPosts = yield* userAdapter.find(
          { name: 'Alice' },
          { joins: [{ table: postsTable, on: { id: 'userId' }, type: 'inner' }], select: { name: 1, title: 1 }, order: { title: 'asc' } },
        );
        expect(withPosts.map((r) => r.title)).toEqual(['Hello World', 'SQLite Tips', 'Tech Deep Dive']);

        const again = yield* userAdapter.find(
          { name: 'Alice' },
          { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'inner' }], select: { name: 1, location: 1 } },
        );
        expect(again).toEqual(withOffices);
      }),
    );

    it.effect('caches and reuses column resolution maps for identical join configurations', () =>
      Effect.gen(function* () {
        const run = () =>
          userAdapter.find({ role: 'user' }, { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'left' }], order: { name: 'asc' } });

        const first = yield* run();
        const second = yield* run();
        expect(second).toEqual(first);
        expect(first.length).toBeGreaterThan(0);
      }),
    );

    it.effect('resolves unique joined column names to the secondary table schema', () =>
      Effect.gen(function* () {
        const rows = yield* userAdapter.find({ location: 'Boston' } as never, {
          joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'inner' }],
          order: { name: 'asc' },
        });

        expect(rows.map((r) => r.users.name)).toEqual(['Mallory', 'Trent']);
      }),
    );

    it.effect('resolves the ambiguous primary key "id" to the primary table in join selection projections', () =>
      Effect.gen(function* () {
        const rows = yield* userAdapter.find(
          { id: 1 },
          { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'inner' }], select: { id: 1, name: 1 } },
        );

        expect(rows).toEqual([{ id: 1, name: 'Alice' }]);
      }),
    );
  });
});

describe('Inserts & Upserts', () => {
  describe('Basic Insert Operations', () => {
    it.effect('persists a single record and returns all generated and schema fields', () =>
      Effect.gen(function* () {
        const newUser: Omit<InsertUser, 'id'> = { name: 'Zane', email: 'zane@example.com', age: 22 };
        const insertedUsers = yield* userAdapter.insert(newUser);
        expectTypeOf(insertedUsers).toEqualTypeOf<User[]>();
        expect(insertedUsers).toHaveLength(1);
        const insertedUser = insertedUsers[0];
        expect(insertedUser).toEqual(
          expect.objectContaining({
            name: 'Zane',
            email: 'zane@example.com',
            age: 22,
            role: 'user',
          }),
        );
        expect(insertedUser.id).toBeTypeOf('number');

        const count = yield* userAdapter.count({ email: 'zane@example.com' });
        expect(count).toBe(1);
      }),
    );

    it.effect('applies schema column default values when fields are omitted from insert payloads', () =>
      Effect.gen(function* () {
        const newPost: Omit<InsertPost, 'id' | 'views'> = { title: 'Post with default views', userId: 1 };
        const insertedPosts = yield* postAdapter.insert(newPost);
        expectTypeOf(insertedPosts).toEqualTypeOf<Post[]>();
        expect(insertedPosts[0].views).toBe(0);

        const newUser: Omit<InsertUser, 'id' | 'role'> = { name: 'Default Role User', email: 'default@example.com' };
        const insertedUser = yield* userAdapter.insert(newUser);
        expectTypeOf(insertedUser).toEqualTypeOf<User[]>();
        expect(insertedUser[0].role).toBe('user');
      }),
    );

    it.effect('batch inserts multiple records in a single database operation', () =>
      Effect.gen(function* () {
        const newUsers: Array<Omit<InsertUser, 'id'>> = [
          { name: 'Yara', email: 'yara@example.com', age: 29 },
          { name: 'Xavi', email: 'xavi@example.com', age: 33 },
        ];
        const insertedUsers = yield* userAdapter.insert(newUsers);
        expectTypeOf(insertedUsers).toEqualTypeOf<User[]>();
        expect(insertedUsers).toHaveLength(2);
        expect(insertedUsers.find((u) => u.name === 'Yara')).toBeDefined();
        expect(insertedUsers.find((u) => u.name === 'Xavi')).toBeDefined();

        const yaraCount = yield* userAdapter.count({ email: 'yara@example.com' });
        expect(yaraCount).toBe(1);

        const xaviCount = yield* userAdapter.count({ email: 'xavi@example.com' });
        expect(xaviCount).toBe(1);
      }),
    );

    it.effect('projects inserted record return payload according to select option', () =>
      Effect.gen(function* () {
        const newUser: Omit<InsertUser, 'id'> = { name: 'Wendy', email: 'wendy@example.com', age: 40 };
        const insertedUsers = yield* userAdapter.insert(newUser, { select: { name: 1, email: 1 } });
        expectTypeOf(insertedUsers).toEqualTypeOf<Array<{ id: number; name: string; email: string | null }>>();
        expect(insertedUsers[0]).toEqual({ id: expect.any(Number), name: 'Wendy', email: 'wendy@example.com' });
      }),
    );

    it.effect('fails with constraint violation error when inserting null into a non-nullable column', () =>
      Effect.gen(function* () {
        const newUser = { email: 'nonnull@example.com' } as Omit<InsertUser, 'id' | 'name'>;
        const exit = yield* Effect.exit(userAdapter.insert(newUser as Omit<InsertUser, 'id'>));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/NOT NULL constraint failed: users.name/i);
      }),
    );

    it.effect('fails with constraint violation error on unhandled unique key collisions', () =>
      Effect.gen(function* () {
        const existingUserEmail = sampleUsers[0].email!;
        const newUser: Omit<InsertUser, 'id'> = { name: 'Conflict User', email: existingUserEmail };
        const exit = yield* Effect.exit(userAdapter.insert(newUser));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/UNIQUE constraint failed: users.email/i);
      }),
    );

    it.effect('fails with foreign key constraint violation error on invalid references', () =>
      Effect.gen(function* () {
        const newUser: Omit<InsertUser, 'id'> = { name: 'FK User', email: 'fk@example.com', officeId: 9999 };
        const exit = yield* Effect.exit(userAdapter.insert(newUser));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/FOREIGN KEY constraint failed/i);
      }),
    );

    it.effect('inserts DEFAULT VALUES when given an empty payload object', () =>
      Effect.gen(function* () {
        const before = yield* defaultsAdapter.count();

        const rows = yield* defaultsAdapter.insert({} as never);
        expect(rows).toHaveLength(1);
        expect(yield* defaultsAdapter.count()).toBe(before + 1);

        const row = rows[0];
        expect(row.a).toBeNull();
        expect(row.b).toBe(42);

        const batch = yield* defaultsAdapter.insert([{}, {}] as never);
        expect(batch).toHaveLength(2);
        expect(yield* defaultsAdapter.count()).toBe(before + 3);

        client.exec("CREATE TABLE defaults_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT DEFAULT 'd')");
        client.exec('INSERT INTO defaults_probe DEFAULT VALUES');
        expect(client.prepare('SELECT count(*) AS c FROM defaults_probe').get()).toEqual({ c: 1 });
        client.exec('DROP TABLE defaults_probe');
      }),
    );

    it.effect('maintains no-op behavior when given an empty insertion array', () =>
      Effect.gen(function* () {
        const before = yield* officeAdapter.count();
        expect(yield* officeAdapter.insert([])).toEqual([]);
        expect(yield* officeAdapter.count()).toBe(before);
      }),
    );

    it.effect('strips primary key "id" property from insertion payloads', () =>
      Effect.gen(function* () {
        const inserted = yield* userAdapter.insert({ id: 9999, name: 'Forced Id', email: 'forcedid@example.com' } as InsertUser);
        expect(inserted[0].id).not.toBe(9999);

        expect(Option.isNone(yield* userAdapter.findOne({ id: 9999 }))).toBe(true);
      }),
    );

    it.effect('treats id-only insert payloads as DEFAULT VALUES insertions', () =>
      Effect.gen(function* () {
        const before = yield* defaultsAdapter.count();

        const inserted = yield* defaultsAdapter.insert({ id: 4242 } as never);
        expect(inserted).toHaveLength(1);
        expect(inserted[0].id).not.toBe(4242);
        expect(yield* defaultsAdapter.count()).toBe(before + 1);
        expect(Option.isNone(yield* defaultsAdapter.findOne({ id: 4242 }))).toBe(true);
      }),
    );

    it.effect('populates omitted schema columns with declared Drizzle default values', () =>
      Effect.gen(function* () {
        const inserted = yield* userAdapter.insert([
          { name: 'With Role', email: 'withrole@example.com', role: 'lead' },
          { name: 'Without Role', email: 'withoutrole@example.com' },
        ]);

        expect(inserted.find((u) => u.email === 'withrole@example.com')!.role).toBe('lead');
        expect(inserted.find((u) => u.email === 'withoutrole@example.com')!.role).toBe('user');
      }),
    );
  });

  describe('Conflict Resolution (ON CONFLICT ignore / update / merge)', () => {
    beforeEach(() => {
      Effect.runSync(
        Effect.provideService(
          Effect.gen(function* () {
            const aliceOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });

            if (Option.isSome(aliceOpt) && aliceOpt.value.bio !== null) {
              yield* userAdapter.update(aliceOpt.value as User & { bio: null });
            }
          }),
          SqliteClientTag,
          db,
        ),
      );
    });

    it.effect('bypasses row insertion on conflict when resolution is set to ignore', () =>
      Effect.gen(function* () {
        const originalAliceOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(originalAliceOpt));
        const originalAlice = originalAliceOpt.value;

        const conflictingUser: Omit<InsertUser, 'id'> = { name: 'New Alice', email: 'alice@example.com', age: 31 };

        const users = yield* userAdapter.insert(conflictingUser, {
          conflict: { target: ['email'], resolution: 'ignore' },
        });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toEqual([]);

        const found = yield* userAdapter.findOne({ email: 'alice@example.com' });
        expectTypeOf(found).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(found)).toBe(true);
        if (Option.isSome(found)) {
          expect(found.value.name).toBe(originalAlice.name);
          expect(found.value.age).toBe(originalAlice.age);
        }
      }),
    );

    it.effect('updates explicitly declared fields on unique key conflict', () =>
      Effect.gen(function* () {
        const aliceEmail = 'alice@example.com';
        const conflictingUser: Omit<InsertUser, 'id'> = { name: 'New Alice Name Attempt', email: aliceEmail, age: 100, role: 'attemptedRole' };

        const updated = yield* userAdapter.insert(conflictingUser, {
          conflict: {
            target: ['email'],
            resolution: 'update',
            set: { name: 'Updated Alice by Conflict', age: 32 },
          },
        });
        expect(updated).toHaveLength(1);
        expectTypeOf(updated).toEqualTypeOf<User[]>();
        expect(updated[0].name).toBe('Updated Alice by Conflict');
        expect(updated[0].age).toBe(32);
        expect(updated[0].email).toBe(aliceEmail);

        const originalAliceOpt = yield* userAdapter.findOne({ email: aliceEmail });
        expectTypeOf(originalAliceOpt).toEqualTypeOf<Option.Option<User>>();
        assert(Option.isSome(originalAliceOpt));

        expect(originalAliceOpt.value.role).not.toBe('attemptedRole');

        const found = yield* userAdapter.findOne({ email: aliceEmail });
        expect(Option.isSome(found)).toBe(true);

        if (Option.isSome(found)) {
          expect(found.value.name).toBe('Updated Alice by Conflict');
          expect(found.value.age).toBe(32);
        }
      }),
    );

    it.effect('applies raw SQL expression modifications on unique key conflict', () =>
      Effect.gen(function* () {
        const initialPair: InsertUniquePair = { valA: 'A1', valB: 'B1', valC: 'Initial C' };
        const insertedInitial = (yield* uniquePairAdapter.insert(initialPair))[0];

        const conflictingPair: InsertUniquePair = { valA: 'A1', valB: 'B1', valC: 'New C' };
        const updatedPair = yield* uniquePairAdapter.insert(conflictingPair, {
          conflict: {
            target: ['valA', 'valB'],
            resolution: 'update',
            set: { valC: sql`${uniquePairTable.valC} || ' updated by SQL'` },
          },
        });
        expectTypeOf(updatedPair).toEqualTypeOf<UniquePair[]>();
        expect(updatedPair).toHaveLength(1);
        expect(updatedPair[0].valC).toBe('Initial C updated by SQL');

        const foundPair = yield* uniquePairAdapter.findOne({ id: insertedInitial.id });
        expectTypeOf(foundPair).toEqualTypeOf<Option.Option<UniquePair>>();
        expect(Option.isSome(foundPair)).toBe(true);
        if (Option.isSome(foundPair)) {
          expect(foundPair.value.valC).toBe('Initial C updated by SQL');
        }
      }),
    );

    it.effect('implicitly updates conflicting records using values from the excluded insert row', () =>
      Effect.gen(function* () {
        const aliceEmail = 'alice@example.com';
        const conflictingUser: Omit<InsertUser, 'id'> = { name: 'Implicit Update Alice', email: aliceEmail, age: 33, role: 'superadmin' };

        const updated = yield* userAdapter.insert(conflictingUser, {
          conflict: {
            target: ['email'],
            resolution: 'update',
            set: {
              name: conflictingUser.name,
              age: conflictingUser.age,
              role: conflictingUser.role,
              email: conflictingUser.email,
            },
          },
        });

        expectTypeOf(updated).toEqualTypeOf<User[]>();
        expect(updated).toHaveLength(1);
        expect(updated[0].name).toBe('Implicit Update Alice');
        expect(updated[0].age).toBe(33);
        expect(updated[0].role).toBe('superadmin');
        expect(updated[0].email).toBe(aliceEmail);

        const found = yield* userAdapter.findOne({ email: aliceEmail });
        expectTypeOf(found).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(found)).toBe(true);

        if (Option.isSome(found)) {
          expect(found.value.name).toBe('Implicit Update Alice');
          expect(found.value.age).toBe(33);
          expect(found.value.role).toBe('superadmin');
        }
      }),
    );

    it.effect('merges insert payload into existing row by updating null fields and keeping non-null fields', () =>
      Effect.gen(function* () {
        const aliceOriginalOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(aliceOriginalOpt));
        const aliceOriginal = aliceOriginalOpt.value;

        yield* userAdapter.update({ ...aliceOriginal, bio: null, age: 30 });
        const aliceAfterBioNullOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(aliceAfterBioNullOpt));
        const aliceAfterBioNull = aliceAfterBioNullOpt.value;
        expect(aliceAfterBioNull.bio).toBeNull();
        expect(aliceAfterBioNull.role).toBe('admin');
        expect(aliceAfterBioNull.age).toBe(30);

        const conflictingUser: Omit<InsertUser, 'id'> = {
          name: 'Merged Alice Name Should Be Ignored',
          email: 'alice@example.com',
          bio: 'Merged Bio From New Value',
          role: 'merged-role-should-be-ignored',
          age: 35,
        };

        const updated = yield* userAdapter.insert(conflictingUser, {
          conflict: {
            target: ['email'],
            resolution: 'merge',
            set: {
              name: conflictingUser.name,
              bio: conflictingUser.bio,
              age: conflictingUser.age,
              role: conflictingUser.role,
            },
          },
        });
        expectTypeOf(updated).toEqualTypeOf<User[]>();
        expect(updated).toHaveLength(1);

        expect(updated[0].name).toBe(aliceAfterBioNull.name);
        expect(updated[0].bio).toBe('Merged Bio From New Value');
        expect(updated[0].role).toBe(aliceAfterBioNull.role);
        expect(updated[0].age).toBe(aliceAfterBioNull.age);

        const foundOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(foundOpt));
        const found = foundOpt.value;

        expect(found.name).toBe(aliceAfterBioNull.name);
        expect(found.bio).toBe('Merged Bio From New Value');
        expect(found.role).toBe(aliceAfterBioNull.role);
        expect(found.age).toBe(aliceAfterBioNull.age);
      }),
    );

    it.effect('resolves unique key collisions over multi-column composite targets', () =>
      Effect.gen(function* () {
        const initialRecord: InsertUniquePair = { valA: 'testA', valB: 'testB', valC: 'initialC' };
        yield* uniquePairAdapter.insert(initialRecord);

        const conflictingRecord: InsertUniquePair = { valA: 'testA', valB: 'testB', valC: 'updatedCFromNew' };
        const updatedRecords = yield* uniquePairAdapter.insert(conflictingRecord, {
          conflict: {
            target: ['valA', 'valB'],
            resolution: 'update',
            set: { valC: 'explicitlyUpdatedC' },
          },
        });
        expectTypeOf(updatedRecords).toEqualTypeOf<UniquePair[]>();
        expect(updatedRecords).toHaveLength(1);
        expect(updatedRecords[0].valC).toBe('explicitlyUpdatedC');

        const found = yield* uniquePairAdapter.findOne({ valA: 'testA', valB: 'testB' });
        expectTypeOf(found).toEqualTypeOf<Option.Option<UniquePair>>();
        expect(Option.isSome(found)).toBe(true);
        if (Option.isSome(found)) {
          expect(found.value.valC).toBe('explicitlyUpdatedC');
        }
      }),
    );
  });

  describe('Advanced Conflict Handling & Encoding', () => {
    it.effect('implicitly maps non-target fields to excluded column updates', () =>
      Effect.gen(function* () {
        const bobEmail = 'bob@example.com';
        const originalBobOpt = yield* userAdapter.findOne({ email: bobEmail });
        assert(Option.isSome(originalBobOpt), 'Expected Bob to be found');
        const originalBob = originalBobOpt.value;

        const conflictingUser: Omit<InsertUser, 'id'> = {
          name: 'Updated Bob Implicitly Full',
          email: bobEmail,
          age: originalBob.age! + 5,
          role: 'super_user_implicit_full',
          officeId: originalBob.officeId === 1 ? 2 : originalBob.officeId === 2 ? 3 : 1,
          bio: 'New bio implicit update full',
        };

        const updatedBob = (yield* userAdapter.insert(conflictingUser, {
          conflict: {
            target: ['email'],
            resolution: 'update',
            set: {
              name: conflictingUser.name,
              age: conflictingUser.age,
              role: conflictingUser.role,
              officeId: conflictingUser.officeId,
              bio: conflictingUser.bio,
            },
          },
        }))[0];

        expectTypeOf(updatedBob).toEqualTypeOf<User>();

        expect(updatedBob.name).toBe(conflictingUser.name);
        expect(updatedBob.age).toBe(conflictingUser.age);
        expect(updatedBob.role).toBe(conflictingUser.role);
        expect(updatedBob.officeId).toBe(conflictingUser.officeId);
        expect(updatedBob.bio).toBe(conflictingUser.bio);
        expect(updatedBob.id).toBe(originalBob.id);

        const foundBob = yield* userAdapter.findOne({ id: originalBob.id });
        expect(foundBob).toEqual(Option.some(updatedBob));
      }),
    );

    it.effect('ignores conflicting rows while inserting non-conflicting rows during batch operations', () =>
      Effect.gen(function* () {
        const newRecords: Array<Omit<InsertUser, 'id'>> = [
          { name: 'Alice New Data', email: 'alice@example.com', age: 100 },
          { name: 'Bob New Data', email: 'bob@example.com', age: 101 },
          { name: 'New Unique User For Batch', email: 'uniquebatchignore@example.com', age: 25 },
        ];
        const inserted = yield* userAdapter.insert(newRecords, {
          conflict: { target: ['email'], resolution: 'ignore' },
        });
        expect(inserted).toHaveLength(1);
        expectTypeOf(inserted).toEqualTypeOf<User[]>();
        expect(inserted[0].email).toBe('uniquebatchignore@example.com');

        const aliceOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        const bobOpt = yield* userAdapter.findOne({ email: 'bob@example.com' });
        assert(Option.isSome(aliceOpt) && Option.isSome(bobOpt), 'Expected users to be found');
        const alice = aliceOpt.value;
        const bob = bobOpt.value;
        expect(alice.age).not.toBe(100);
        expect(bob.age).not.toBe(101);
      }),
    );

    it.effect('updates existing rows and inserts new rows during mixed batch operations', () =>
      Effect.gen(function* () {
        const newRecords: Array<Omit<InsertUser, 'id'>> = [
          { name: 'Alice Updated Batch', email: 'alice@example.com', age: 100 },
          { name: 'Bob Updated Batch', email: 'bob@example.com', age: 101 },
          { name: 'New User Batch Insert', email: 'uniquebatchupdate@example.com', age: 25 },
        ];

        const processed = yield* userAdapter.insert(newRecords, {
          conflict: {
            target: ['email'],
            resolution: 'update',
            set: {
              name: 'multiple conflict',
              age: 1000,
            },
          },
        });

        expect(processed).toHaveLength(3);
        expectTypeOf(processed).toEqualTypeOf<User[]>();

        const alice = processed.find((u) => u.email === 'alice@example.com')!;
        const bob = processed.find((u) => u.email === 'bob@example.com')!;
        const uniqueUser = processed.find((u) => u.email === 'uniquebatchupdate@example.com')!;

        expect(alice.name).toBe('multiple conflict');
        expect(alice.age).toBe(1000);
        expect(bob.name).toBe('multiple conflict');
        expect(bob.age).toBe(1000);
        expect(uniqueUser.name).toBe('New User Batch Insert');
        expect(uniqueUser.age).toBe(25);
      }),
    );

    it.effect('excludes target columns from implicit conflict set expressions', () =>
      Effect.gen(function* () {
        client.exec('CREATE TABLE nocase_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT COLLATE NOCASE UNIQUE, v TEXT)');
        const probeTable = sqliteTable('nocase_probe', {
          id: integer('id').primaryKey({ autoIncrement: true }),
          k: text('k'),
          v: text('v'),
        });
        const probe = Adapter(db, probeTable);

        yield* probe.insert({ k: 'alice@example.com', v: 'first' });

        const merged = yield* probe.insert({ k: 'ALICE@EXAMPLE.COM', v: 'second' }, { conflict: { resolution: 'update', target: ['k'] } });

        expect(merged[0].k).toBe('alice@example.com');
        expect(merged[0].v).toBe('second');
        client.exec('DROP TABLE nocase_probe');
      }),
    );

    it.effect('fails fast when implicit conflict resolution yields an empty update set', () =>
      Effect.gen(function* () {
        client.exec('CREATE TABLE only_target_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT UNIQUE)');
        const probeTable = sqliteTable('only_target_probe', {
          id: integer('id').primaryKey({ autoIncrement: true }),
          k: text('k'),
        });
        const probe = Adapter(db, probeTable);
        yield* probe.insert({ k: 'a' });

        const exit = yield* Effect.exit(probe.insert({ k: 'a' }, { conflict: { resolution: 'update', target: ['k'] } }));
        assert(Exit.isFailure(exit));
        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        expect(failure.value).toBeInstanceOf(SqliteClientError);
        expect((failure.value as SqliteClientError).message).toMatch(/requires at least one valid column to set/i);

        const updated = yield* probe.insert({ k: 'a' }, { conflict: { resolution: 'update', target: ['k'], set: { k: 'b' } } });
        expect(updated[0].k).toBe('b');
        client.exec('DROP TABLE only_target_probe');
      }),
    );

    it.effect('maps batch conflict update sets to excluded row values', () =>
      Effect.gen(function* () {
        const processed = yield* userAdapter.insert(
          [
            { name: 'Alice Excluded', email: 'alice@example.com', age: 111 },
            { name: 'Bob Excluded', email: 'bob@example.com', age: 222 },
            { name: 'Fresh Excluded', email: 'fresh-excluded@example.com', age: 333 },
          ],
          { conflict: { target: ['email'], resolution: 'update' } },
        );

        expect(processed).toHaveLength(3);
        expect(processed.find((u) => u.email === 'alice@example.com')).toEqual(expect.objectContaining({ name: 'Alice Excluded', age: 111 }));
        expect(processed.find((u) => u.email === 'bob@example.com')).toEqual(expect.objectContaining({ name: 'Bob Excluded', age: 222 }));
        expect(processed.find((u) => u.email === 'fresh-excluded@example.com')).toEqual(
          expect.objectContaining({ name: 'Fresh Excluded', age: 333 }),
        );
      }),
    );

    it.effect('preserves existing non-null fields while populating null fields during merge', () =>
      Effect.gen(function* () {
        const eve = yield* userAdapter.findOne({ email: 'eve@example.com' });
        assert(Option.isSome(eve));
        expect(eve.value.bio).toBeNull();

        const merged = yield* userAdapter.insert(
          { name: 'Eve Merged', email: 'eve@example.com', bio: 'Filled bio', age: 99 },
          {
            conflict: { target: ['email'], resolution: 'merge' },
          },
        );

        expect(merged).toHaveLength(1);
        expect(merged[0].bio).toBe('Filled bio');
        expect(merged[0].name).toBe(eve.value.name);
        expect(merged[0].age).toBe(eve.value.age);
      }),
    );

    it.effect('emits targetless ON CONFLICT DO NOTHING when conflict target is empty array', () =>
      Effect.gen(function* () {
        const inserted = yield* userAdapter.insert(
          { name: 'Ignored', email: 'alice@example.com' },
          { conflict: { target: [], resolution: 'ignore' } },
        );
        expect(inserted).toEqual([]);

        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(alice));
        expect(alice.value.name).toBe('Alice');
      }),
    );

    it.effect('fails fast when update conflict resolution is requested without conflict target', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          userAdapter.insert({ name: 'Invalid', email: 'alice@example.com' }, { conflict: { target: [], resolution: 'update' } }),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/requires at least one valid target column/i);
      }),
    );

    it.effect('fails with SQLite error when conflict target is not covered by unique index', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          userAdapter.insert({ name: 'Alice', email: 'dup@example.com' }, { conflict: { target: ['name'], resolution: 'ignore' } }),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint/i);
      }),
    );

    it.effect('strips undefined and unknown column properties from conflict set payloads', () =>
      Effect.gen(function* () {
        const updated = yield* userAdapter.insert(
          { name: 'Ignored Name', email: 'alice@example.com', age: 51 },
          {
            conflict: {
              target: ['email'],
              resolution: 'update',
              set: { age: 52, bio: undefined, unknownColumn: 'nope' } as never,
            },
          },
        );

        expect(updated).toHaveLength(1);
        expect(updated[0].age).toBe(52);
        expect(updated[0].name).toBe('Alice');
      }),
    );

    it.effect('fails fast with SqliteClientError when given an unsupported resolution strategy', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          userAdapter.insert({ name: 'Bogus', email: 'bogus@example.com' }, { conflict: { target: ['email'], resolution: 'nope' as never } }),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/Unsupported conflict resolution "nope"/i);
      }),
    );

    it.effect('respects Drizzle snake_case casing configuration during conflict set mapping', () =>
      Effect.gen(function* () {
        const cased = drizzle(client, { casing: 'snake_case' });
        const adapter = Adapter(cased, casingTable);

        yield* adapter.insert([
          { userKey: 'k1', displayName: 'one' },
          { userKey: 'k2', displayName: 'two' },
        ]);

        const upserted = yield* adapter.insert(
          [
            { userKey: 'k1', displayName: 'ONE' },
            { userKey: 'k2', displayName: 'TWO' },
          ],
          { conflict: { target: ['userKey'], resolution: 'update' } },
        );

        expect(upserted).toHaveLength(2);
        expect([...upserted].sort((a, b) => a.id - b.id).map((r) => [r.id, r.userKey, r.displayName])).toEqual([
          [1, 'k1', 'ONE'],
          [2, 'k2', 'TWO'],
        ]);
      }),
    );

    it.effect('encodes set values through column mappers during conflict merge resolution', () =>
      Effect.gen(function* () {
        yield* typedAdapter.insert({ label: 'alpha', occurredAt: null, active: null, meta: null });

        const merged = yield* typedAdapter.insert(
          { label: 'alpha' },
          { conflict: { resolution: 'merge', target: ['label'], set: { occurredAt: DATE_B, active: true, meta: { tag: 'filled' } } } },
        );

        expect(merged).toHaveLength(1);
        expect(merged[0].occurredAt).toBeInstanceOf(Date);
        expect(merged[0].occurredAt!.getTime()).toBe(DATE_B.getTime());
        expect(merged[0].active).toBe(true);
        expect(merged[0].meta).toEqual({ tag: 'filled' });

        const raw = client.prepare('SELECT occurred_at, active FROM typed_table WHERE label = ?').get('alpha') as {
          occurred_at: number;
          active: number;
        };
        expect(raw.occurred_at).toBe(Math.floor(DATE_B.getTime() / 1000));
        expect(raw.active).toBe(1);
      }),
    );

    it.effect('retains existing non-null values over encoded conflict merge values', () =>
      Effect.gen(function* () {
        yield* typedAdapter.insert({ label: 'alpha', occurredAt: DATE_A, active: false });

        const merged = yield* typedAdapter.insert(
          { label: 'alpha' },
          { conflict: { resolution: 'merge', target: ['label'], set: { occurredAt: DATE_B, active: true } } },
        );

        expect(merged[0].occurredAt!.getTime()).toBe(DATE_A.getTime());
        expect(merged[0].active).toBe(false);
      }),
    );

    it.effect('produces identical value encodings between update and merge conflict strategies', () =>
      Effect.gen(function* () {
        yield* typedAdapter.insert([
          { label: 'a', occurredAt: null },
          { label: 'b', occurredAt: null },
        ]);

        const updated = yield* typedAdapter.insert(
          { label: 'a' },
          { conflict: { resolution: 'update', target: ['label'], set: { occurredAt: DATE_B } } },
        );
        const merged = yield* typedAdapter.insert(
          { label: 'b' },
          { conflict: { resolution: 'merge', target: ['label'], set: { occurredAt: DATE_B } } },
        );

        expect(updated[0].occurredAt!.getTime()).toBe(merged[0].occurredAt!.getTime());
      }),
    );

    it.effect('supports raw SQL expressions within conflict merge set payloads', () =>
      Effect.gen(function* () {
        yield* uniquePairAdapter.insert({ valA: 'A1', valB: 'B1', valC: null });

        const merged = yield* uniquePairAdapter.insert(
          { valA: 'A1', valB: 'B1' },
          { conflict: { resolution: 'merge', target: ['valA', 'valB'], set: { valC: sql`'from-sql'` } } },
        );

        expect(merged[0].valC).toBe('from-sql');
      }),
    );
  });
});

describe('Updates & Deletes', () => {
  describe('Update Operations & Column Touch Scope', () => {
    it.effect('updates matching record by primary key and returns updated schema fields', () =>
      Effect.gen(function* () {
        const aliceOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(aliceOpt));
        const alice = aliceOpt.value;

        const updatedData: User = { ...alice, name: 'Alice Smith', age: 31 };

        const updatedUsers = yield* userAdapter.update(updatedData);
        expectTypeOf(updatedUsers).toEqualTypeOf<User[]>();
        expect(updatedUsers).toHaveLength(1);
        expect(updatedUsers[0].name).toBe('Alice Smith');
        expect(updatedUsers[0].age).toBe(31);
        expect(updatedUsers[0].id).toBe(alice.id);

        const found = yield* userAdapter.findOne({ id: alice.id });
        expectTypeOf(found).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(found)).toBe(true);
        if (Option.isSome(found)) {
          expect(found.value.name).toBe('Alice Smith');
        }
      }),
    );

    it.effect('persists explicit null assignments to nullable columns', () =>
      Effect.gen(function* () {
        const bobOpt = yield* userAdapter.findOne({ email: 'bob@example.com' });
        assert(Option.isSome(bobOpt), 'Expected Bob to be found');
        const bob = bobOpt.value;
        expect(bob.bio).not.toBeNull();

        const updatedData: User = { ...bob, bio: null };
        const users = yield* userAdapter.update(updatedData);
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users[0].bio).toBeNull();

        const found = yield* userAdapter.findOne({ id: bob.id });
        expectTypeOf(found).toEqualTypeOf<Option.Option<User>>();
        if (Option.isSome(found)) {
          expect(found.value.bio).toBeNull();
        }
      }),
    );

    it.effect('projects updated record return payload according to select option', () =>
      Effect.gen(function* () {
        const bobOpt = yield* userAdapter.findOne({ email: 'bob@example.com' });
        assert(Option.isSome(bobOpt), 'Expected Bob to be found');
        const bob = bobOpt.value;

        const updatedData: User = { ...bob, role: 'lead_user' };

        const updatedUsers = yield* userAdapter.update(updatedData, { select: { id: 1, role: 1 } });
        expectTypeOf(updatedUsers).toEqualTypeOf<Array<{ id: number; role: string | null }>>();
        expect(updatedUsers[0]).toEqual({ id: bob.id, role: 'lead_user' });
      }),
    );

    it.effect('fails with SqliteClientError when update payload lacks an id property', () =>
      Effect.gen(function* () {
        const invalidUser = { name: 'No ID User', email: 'noid@example.com' } as unknown as User;
        const exit = yield* Effect.exit(userAdapter.update(invalidUser));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/Missing required "id" for update operation/i);
      }),
    );

    it.effect('returns an empty array when updating a non-existent primary key', () =>
      Effect.gen(function* () {
        const nonExistentUser: User = { id: 9999, name: 'Ghost', email: 'ghost@example.com', age: null, role: null, officeId: null, bio: null };
        const users = yield* userAdapter.update(nonExistentUser);
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toEqual([]);
      }),
    );

    it.effect('fails with unique constraint error on conflicting update operations', () =>
      Effect.gen(function* () {
        const aliceOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        const bobOpt = yield* userAdapter.findOne({ email: 'bob@example.com' });
        assert(Option.isSome(aliceOpt) && Option.isSome(bobOpt), 'Expected users to be found');
        const alice = aliceOpt.value;
        const bob = bobOpt.value;

        const updatedBob: User = { ...bob, email: alice.email };
        const exit = yield* Effect.exit(userAdapter.update(updatedBob));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/UNIQUE constraint failed: users.email/i);
      }),
    );

    it.effect('fails with foreign key error on invalid reference updates', () =>
      Effect.gen(function* () {
        const charlieOpt = yield* userAdapter.findOne({ email: 'charlie@example.com' });
        assert(Option.isSome(charlieOpt), 'Expected Charlie to be found');
        const charlie = charlieOpt.value;
        const updatedCharlie: User = { ...charlie, officeId: 9999 };
        const exit = yield* Effect.exit(userAdapter.update(updatedCharlie));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/FOREIGN KEY constraint failed/i);
      }),
    );

    it.effect('ignores primary key modifications attempted inside update payloads', () =>
      Effect.gen(function* () {
        const charlieOpt = yield* userAdapter.findOne({ email: 'charlie@example.com' });
        assert(Option.isSome(charlieOpt), 'Expected Charlie to be found');
        const charlie = charlieOpt.value;
        const updateDataWithChangedIdField: User = {
          ...charlie,
          id: charlie.id + 1000,
          name: 'Charlie Did ID Change?',
        };

        const updatedUsers = yield* userAdapter.update(updateDataWithChangedIdField);
        expectTypeOf(updatedUsers).toEqualTypeOf<User[]>();
        expect(updatedUsers.length).toBe(0);
      }),
    );

    it.effect('prevents rewriting primary key columns during row update execution', () =>
      Effect.gen(function* () {
        client.exec(
          'CREATE TABLE IF NOT EXISTS pk_touch_log (msg TEXT);' +
            'DELETE FROM pk_touch_log;' +
            "CREATE TRIGGER users_pk_touch AFTER UPDATE OF id ON users BEGIN INSERT INTO pk_touch_log VALUES ('fired'); END;",
        );

        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(alice));

        const updated = yield* userAdapter.update({ ...alice.value, name: 'Alice Renamed' });
        expect(updated[0].name).toBe('Alice Renamed');

        const log = client.prepare('SELECT COUNT(*) AS n FROM pk_touch_log').get() as { n: number };
        expect(log.n).toBe(0);
      }),
    );

    it.effect('executes zero-column update successfully when payload contains only id', () =>
      Effect.gen(function* () {
        const readTouched = watchUpdatedColumns(['id', 'name', 'email', 'age', 'role', 'bio']);

        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(alice));

        const updated = yield* userAdapter.update({ id: alice.value.id } as User);
        expect(updated).toHaveLength(1);
        expect(updated[0]).toEqual(alice.value);
        expect(readTouched()).toEqual([]);
      }),
    );

    it.effect('applies projection when updating with an id-only payload', () =>
      Effect.gen(function* () {
        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(alice));

        const updated = yield* userAdapter.update({ id: alice.value.id } as User, { select: { name: 1 } });
        expect(updated).toEqual([{ id: alice.value.id, name: 'Alice' }]);
      }),
    );

    it.effect('returns empty array when updating non-existent row with id-only payload', () =>
      Effect.gen(function* () {
        expect(yield* userAdapter.update({ id: 999_999 } as User)).toEqual([]);
      }),
    );

    it.effect('restricts modified database columns strictly to payload properties', () =>
      Effect.gen(function* () {
        const readTouched = watchUpdatedColumns(['id', 'name', 'email', 'age', 'role', 'bio']);

        const bob = yield* userAdapter.findOne({ email: 'bob@example.com' });
        assert(Option.isSome(bob));

        yield* userAdapter.update({ id: bob.value.id, role: 'writer' } as User);
        expect(readTouched()).toEqual(['role']);
      }),
    );

    it.effect('ignores undefined payload fields during update operations', () =>
      Effect.gen(function* () {
        const bob = yield* userAdapter.findOne({ email: 'bob@example.com' });
        assert(Option.isSome(bob));

        const updated = yield* userAdapter.update({ ...bob.value, bio: undefined as never, role: 'kept' });
        expect(updated[0].role).toBe('kept');
        expect(updated[0].bio).toBe(bob.value.bio);
      }),
    );
  });

  describe('Delete Operations & Foreign Key Cascades', () => {
    it.effect('deletes matching record by primary key and returns deleted row payload', () =>
      Effect.gen(function* () {
        const charlieOpt = yield* userAdapter.findOne({ email: 'charlie@example.com' });
        assert(Option.isSome(charlieOpt), 'Expected Charlie to be found');
        const charlie = charlieOpt.value;

        const deletedUsers = yield* userAdapter.delete(charlie);
        expectTypeOf(deletedUsers).toEqualTypeOf<User[]>();
        expect(deletedUsers).toHaveLength(1);
        expect(deletedUsers[0].id).toBe(charlie.id);
        expect(deletedUsers[0].name).toBe(charlie.name);

        const found = yield* userAdapter.findOne({ id: charlie.id });
        expect(Option.isNone(found)).toBe(true);

        const count = yield* userAdapter.count();
        expect(count).toBe(sampleUsers.length - 1);
      }),
    );

    it.effect('projects deleted record return payload according to select option', () =>
      Effect.gen(function* () {
        const davidOpt = yield* userAdapter.findOne({ email: 'david@example.com' });
        assert(Option.isSome(davidOpt), 'Expected David to be found');
        const david = davidOpt.value;

        const deletedUsers = yield* userAdapter.delete(david, { select: { name: 1 } });
        expectTypeOf(deletedUsers).toEqualTypeOf<Array<{ id: number; name: string }>>();

        expect(deletedUsers[0]).toEqual({ id: david.id, name: 'David' });
        expect(Object.keys(deletedUsers[0]).sort()).toEqual(['id', 'name'].sort());
      }),
    );

    it.effect('fails with SqliteClientError when delete payload lacks an id property', () =>
      Effect.gen(function* () {
        const invalidUser = { name: 'No ID User To Delete' } as unknown as User;
        const exit = yield* Effect.exit(userAdapter.delete(invalidUser));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/Missing required "id" for delete operation/i);
      }),
    );

    it.effect('returns an empty array when deleting a non-existent primary key', () =>
      Effect.gen(function* () {
        const nonExistentUser: User = { id: 8888, name: 'Phantom', email: 'phantom@example.com', age: null, role: null, officeId: null, bio: null };
        const users = yield* userAdapter.delete(nonExistentUser);
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toEqual([]);
      }),
    );

    it.effect('cascades user row deletions to dependent child post records', () =>
      Effect.gen(function* () {
        const aliceOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(aliceOpt));
        const alice = aliceOpt.value;

        const alicePostsBefore = yield* postAdapter.find({ userId: alice.id });
        expectTypeOf(alicePostsBefore).toEqualTypeOf<Post[]>();
        expect(alicePostsBefore.length).toBeGreaterThan(0);

        const deletedUsers = yield* userAdapter.delete(alice);
        expectTypeOf(deletedUsers).toEqualTypeOf<User[]>();

        const alicePostsAfter = yield* postAdapter.find({ userId: alice.id });
        expectTypeOf(alicePostsAfter).toEqualTypeOf<Post[]>();
        expect(alicePostsAfter).toHaveLength(0);
      }),
    );

    it.effect('cascades parent office deletions across multi-level user and post relationships', () =>
      Effect.gen(function* () {
        const hqOfficeOpt = yield* officeAdapter.findOne({ name: 'HQ' });
        assert(Option.isSome(hqOfficeOpt), 'Expected HQ office to be found');
        const hqOffice = hqOfficeOpt.value;

        const usersInHQBefore = yield* userAdapter.find({ officeId: hqOffice.id });
        expectTypeOf(usersInHQBefore).toEqualTypeOf<User[]>();
        expect(usersInHQBefore.length).toBeGreaterThan(0);

        const userIdsInHQ = usersInHQBefore.map((u) => u.id);
        const postsOfUsersInHQBefore = yield* postAdapter.find({ userId: { $in: userIdsInHQ } });
        expectTypeOf(postsOfUsersInHQBefore).toEqualTypeOf<Post[]>();
        expect(postsOfUsersInHQBefore.length).toBeGreaterThan(0);

        const deletedOffices = yield* officeAdapter.delete(hqOffice);
        expectTypeOf(deletedOffices).toEqualTypeOf<Office[]>();

        const usersInHQAfter = yield* userAdapter.find({ officeId: hqOffice.id });
        expectTypeOf(usersInHQAfter).toEqualTypeOf<User[]>();
        expect(usersInHQAfter).toHaveLength(0);

        const postsOfUsersInHQAfter = yield* postAdapter.find({ userId: { $in: userIdsInHQ } });
        expectTypeOf(postsOfUsersInHQAfter).toEqualTypeOf<Post[]>();
        expect(postsOfUsersInHQAfter).toHaveLength(0);
      }),
    );
  });
});

describe('findOneAndUpdate & findOneAndDelete', () => {
  describe('findOneAndUpdate Operations', () => {
    it.effect('locates and updates first matching row returning updated entity as Option.some', () =>
      Effect.gen(function* () {
        const eveOriginalOpt = yield* userAdapter.findOne({ email: 'eve@example.com' });
        assert(Option.isSome(eveOriginalOpt), 'Expected Eve to be found');
        const eveOriginal = eveOriginalOpt.value;

        const updatePayload = { age: 31, role: 'senior_manager' };

        const updatedUserOpt = yield* userAdapter.findOneAndUpdate({ email: 'eve@example.com' }, updatePayload);

        expectTypeOf(updatedUserOpt).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(updatedUserOpt)).toBe(true);
        if (Option.isSome(updatedUserOpt)) {
          const updatedUser = updatedUserOpt.value;
          expect(updatedUser.id).toBe(eveOriginal.id);
          expect(updatedUser.age).toBe(updatePayload.age);
          expect(updatedUser.role).toBe(updatePayload.role);
        }

        const found = yield* userAdapter.findOne({ id: eveOriginal.id });
        expect(Option.isSome(found)).toBe(true);
        if (Option.isSome(found)) {
          expect(found.value.age).toBe(updatePayload.age);
          expect(found.value.role).toBe(updatePayload.role);
        }
      }),
    );

    it.effect('upserts new record combining filter and update payloads when upsert is true', () =>
      Effect.gen(function* () {
        const newUserEmail = 'newupsert@example.com';

        const filterForUpsert: Partial<User> = { email: newUserEmail };
        const upsertPayload: Partial<Omit<InsertUser, 'id'>> = { name: 'New Upserted', age: 25, role: 'intern' };

        const upsertedUserOpt = yield* userAdapter.findOneAndUpdate(filterForUpsert, upsertPayload, { upsert: true });

        expectTypeOf(upsertedUserOpt).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(upsertedUserOpt)).toBe(true);
        if (Option.isSome(upsertedUserOpt)) {
          const upsertedUser = upsertedUserOpt.value;

          expect(upsertedUser.email).toBe(newUserEmail);
          expect(upsertedUser.name).toBe(upsertPayload.name);
          expect(upsertedUser.age).toBe(upsertPayload.age);
          expect(upsertedUser.role).toBe(upsertPayload.role);
          expect(upsertedUser.id).toBeTypeOf('number');
        }

        const found = yield* userAdapter.findOne({ email: newUserEmail });
        expect(Option.isSome(found)).toBe(true);
        if (Option.isSome(found)) {
          expect(found.value.name).toBe(upsertPayload.name);
        }
      }),
    );

    it.effect('merges filter and update properties prioritizing update keys during upsert', () =>
      Effect.gen(function* () {
        const newUserEmail = 'newupsertfilter@example.com';
        const filterData: Partial<User> = { email: newUserEmail, role: 'default_role_from_filter', name: 'Name From Filter (will be overwritten)' };
        const updateData: Partial<Omit<InsertUser, 'id'>> = { name: 'New Upserted Filter', age: 26 };

        const upsertedUserOpt = yield* userAdapter.findOneAndUpdate(filterData, updateData, { upsert: true });

        expectTypeOf(upsertedUserOpt).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(upsertedUserOpt)).toBe(true);
        if (Option.isSome(upsertedUserOpt)) {
          const upsertedUser = upsertedUserOpt.value;
          expect(upsertedUser.email).toBe(newUserEmail);
          expect(upsertedUser.name).toBe(updateData.name);
          expect(upsertedUser.age).toBe(updateData.age);
          expect(upsertedUser.role).toBe(filterData.role);
        }
      }),
    );

    it.effect('returns Option.none when no match is found and upsert is false', () =>
      Effect.gen(function* () {
        const user = yield* userAdapter.findOneAndUpdate({ email: 'nosuchuser@example.com' }, { name: 'No Update' });
        expect(Option.isNone(user)).toBe(true);
      }),
    );

    it.effect('applies selection projection to updated records', () =>
      Effect.gen(function* () {
        const malloryOriginalOpt = yield* userAdapter.findOne({ email: 'mallory@example.com' });
        assert(Option.isSome(malloryOriginalOpt), 'Expected Mallory to be found');
        const malloryOriginal = malloryOriginalOpt.value;

        const updatePayload = { bio: 'Updated Bio via FindOneAndUpdate' };

        const selectedUser = yield* userAdapter.findOneAndUpdate({ email: 'mallory@example.com' }, updatePayload, { select: { id: 1, bio: 1 } });
        expectTypeOf(selectedUser).toEqualTypeOf<Option.Option<{ id: number; bio: string | null }>>();
        expect(Option.isSome(selectedUser)).toBe(true);
        if (Option.isSome(selectedUser)) {
          expect(selectedUser.value).toEqual({ id: malloryOriginal.id, bio: updatePayload.bio });
        }
      }),
    );

    it.effect('applies selection projection to newly upserted records', () =>
      Effect.gen(function* () {
        const newUserEmail = 'selectupsert@example.com';
        const filterForUpsert: Partial<User> = { email: newUserEmail };
        const unwrappedResult = yield* userAdapter.findOneAndUpdate(
          filterForUpsert,
          { name: 'Select Upsert', age: 22 },
          { upsert: true, select: { name: 1, email: 1 } },
        );
        expectTypeOf(unwrappedResult).toEqualTypeOf<Option.Option<{ id: number; name: string; email: string | null }>>();
        expect(Option.isSome(unwrappedResult)).toBe(true);
        if (Option.isSome(unwrappedResult)) {
          expect(unwrappedResult.value).toEqual(expect.objectContaining({ id: expect.any(Number), name: 'Select Upsert', email: newUserEmail }));
        }
      }),
    );

    it.effect('returns unmodified matching row when provided an empty update object', () =>
      Effect.gen(function* () {
        const aliceOpt = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(aliceOpt));
        const alice = aliceOpt.value;

        const returnedUserOpt = yield* userAdapter.findOneAndUpdate({ email: 'alice@example.com' }, {});

        expectTypeOf(returnedUserOpt).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(returnedUserOpt)).toBe(true);
        if (Option.isSome(returnedUserOpt)) {
          expect(returnedUserOpt.value.id).toBe(alice.id);
          expect(returnedUserOpt.value.name).toBe(alice.name);
        }

        const aliceAfter = yield* userAdapter.findOne({ id: alice.id });
        expect(aliceAfter).toEqual(Option.some(alice));
      }),
    );

    it.effect('inserts new row on empty database when upsert is enabled', () =>
      Effect.gen(function* () {
        client.exec('DELETE FROM users;');
        const newUserEmail = 'emptyupsert@example.com';
        const filterForUpsert: Partial<User> = { email: newUserEmail };
        const payload = { name: 'Empty Upsert', age: 20 };
        const userOpt = yield* userAdapter.findOneAndUpdate(filterForUpsert, payload, { upsert: true });
        expectTypeOf(userOpt).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(userOpt)).toBe(true);
        if (Option.isSome(userOpt)) {
          expect(userOpt.value.email).toBe(newUserEmail);
          expect(userOpt.value.name).toBe(payload.name);
        }
        expect(yield* userAdapter.count()).toBe(1);
      }),
    );

    it.effect('fails with NOT NULL constraint error when upsert payload lacks required fields', () =>
      Effect.gen(function* () {
        const newUserEmail = 'failupsert@example.com';

        const filterForUpsert: Partial<User> = { email: newUserEmail };
        const payload = { age: 22 };
        const exit = yield* Effect.exit(userAdapter.findOneAndUpdate(filterForUpsert, payload, { upsert: true }));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/NOT NULL constraint failed: users.name/i);
      }),
    );

    it.effect('updates only the first row matching multi-record filter criteria according to order', () =>
      Effect.gen(function* () {
        const usersAge30 = sampleUsers.filter((u) => u.age === 30);
        expect(usersAge30.length).toBeGreaterThan(1);

        const initialAge30Users = yield* userAdapter.find({ age: 30 }, { order: { id: 'asc' } });
        const firstUserId = initialAge30Users[0].id;

        const updatedUserOpt = yield* userAdapter.findOneAndUpdate(
          { age: 30 },
          { bio: 'Updated by findOneAndUpdate for age 30' },
          { order: { id: 'asc' } },
        );
        expectTypeOf(updatedUserOpt).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(updatedUserOpt)).toBe(true);
        if (Option.isSome(updatedUserOpt)) {
          expect(updatedUserOpt.value.id).toBe(firstUserId);
          expect(updatedUserOpt.value.bio).toBe('Updated by findOneAndUpdate for age 30');
        }

        const otherAge30Users = yield* userAdapter.find({ age: 30, id: { $ne: firstUserId } });
        otherAge30Users.forEach((user) => {
          const originalUser = usersAge30.find((u) => u.email === user.email);
          expect(user.bio).toBe(originalUser?.bio);
        });
      }),
    );

    it.effect('fails when upsert insertion triggers a unique constraint collision on secondary field', () =>
      Effect.gen(function* () {
        const bobEmail = sampleUsers.find((u) => u.name === 'Bob')!.email!;
        const newNonExistentEmail = 'nonexistentupsertconflict@example.com';

        const exit = yield* Effect.exit(
          userAdapter.findOneAndUpdate({ email: newNonExistentEmail }, { name: 'Conflicting Upsert', email: bobEmail, age: 40 }, { upsert: true }),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/UNIQUE constraint failed: users.email/i);
        expect(Option.isNone(yield* userAdapter.findOne({ email: newNonExistentEmail }))).toBe(true);
        const bobUserOpt = yield* userAdapter.findOne({ email: bobEmail });
        assert(Option.isSome(bobUserOpt), 'Expected Bob to be found');
        if (Option.isSome(bobUserOpt)) {
          expect(bobUserOpt.value.name).toBe('Bob');
        }
      }),
    );

    it.effect('fails when upsert update phase triggers unique key conflict with another row', () =>
      Effect.gen(function* () {
        const aliceEmail = sampleUsers.find((u) => u.name === 'Alice')!.email!;
        const bobEmail = sampleUsers.find((u) => u.name === 'Bob')!.email!;

        const exit = yield* Effect.exit(userAdapter.findOneAndUpdate({ email: aliceEmail }, { email: bobEmail }, { upsert: true }));

        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/UNIQUE constraint failed: users.email/i);
        const aliceUserOpt = yield* userAdapter.findOne({ name: 'Alice' });
        assert(Option.isSome(aliceUserOpt));
        if (Option.isSome(aliceUserOpt)) {
          expect(aliceUserOpt.value.email).toBe(aliceEmail);
        }
      }),
    );

    it.effect('retains null values present in filter during upsert insertion', () =>
      Effect.gen(function* () {
        const filterWithNull: Partial<User> = { email: 'upsertnullbio@example.com', bio: null };
        const payload = { name: 'Upsert Null Bio User', age: 33 };

        const userOpt = yield* userAdapter.findOneAndUpdate(filterWithNull, payload, { upsert: true });
        expectTypeOf(userOpt).toEqualTypeOf<Option.Option<User>>();

        expect(Option.isSome(userOpt)).toBe(true);
        if (Option.isSome(userOpt)) {
          expect(userOpt.value.email).toBe(filterWithNull.email);
          expect(userOpt.value.name).toBe(payload.name);
          expect(userOpt.value.bio).toBeNull();
          expect(userOpt.value.age).toBe(payload.age);
        }

        const dbUserOpt = yield* userAdapter.findOne({ email: filterWithNull.email });
        assert(Option.isSome(dbUserOpt), 'Expected user to be found');
        if (Option.isSome(dbUserOpt)) {
          expect(dbUserOpt.value.bio).toBeNull();
        }
      }),
    );

    it.effect('disallows complex query operators ($gt, $or, etc.) when upsert is enabled', () =>
      Effect.gen(function* () {
        const complexFilter = { age: { $gt: 200 } } as never;
        const payload: Partial<Omit<InsertUser, 'id'>> = {
          name: 'Should Fail',
          email: 'fail@example.com',
          age: 201,
        };

        const exit = yield* Effect.exit(userAdapter.findOneAndUpdate(complexFilter, payload, { upsert: true }));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/Cannot use complex filter when upserting/i);
      }),
    );

    it.effect('fails with SqliteClientError when upsert filter references unknown columns', () =>
      Effect.gen(function* () {
        const before = yield* userAdapter.count();

        const exit = yield* Effect.exit(userAdapter.findOneAndUpdate({ nope: 'x' } as never, { name: 'Ghost' }, { upsert: true } as never));
        assert(Exit.isFailure(exit));
        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        expect(failure.value).toBeInstanceOf(SqliteClientError);
        expect((failure.value as SqliteClientError).message).toMatch(/Unknown column "nope"/);

        expect(yield* userAdapter.count()).toBe(before);
        expect(yield* userAdapter.count({ name: 'Ghost' })).toBe(0);
      }),
    );

    it.effect('supports comparison operator filters on primary key "id" column', () =>
      Effect.gen(function* () {
        const all = yield* userAdapter.find({}, { order: { id: 'asc' } });
        const second = all[1];

        const updated = yield* userAdapter.findOneAndUpdate({ id: { $gte: second.id } }, { role: 'picked' });
        assert(Option.isSome(updated));
        expect(updated.value.id).toBe(second.id);
        expect(updated.value.role).toBe('picked');

        const ordered = yield* userAdapter.findOneAndUpdate({ id: { $gte: second.id } }, { role: 'picked-desc' }, { order: { id: 'desc' } });
        assert(Option.isSome(ordered));
        expect(ordered.value.id).toBe(all[all.length - 1].id);

        const deleted = yield* userAdapter.findOneAndDelete({ id: { $gt: second.id } });
        assert(Option.isSome(deleted));
        expect(deleted.value.id).toBe(all[2].id);
      }),
    );

    it.effect('evaluates { id: null } filter as IS NULL predicate instead of equality', () =>
      Effect.gen(function* () {
        expect(Option.isNone(yield* userAdapter.findOneAndUpdate({ id: null as never }, { role: 'nope' }))).toBe(true);
        expect(Option.isNone(yield* userAdapter.findOneAndDelete({ id: null as never }))).toBe(true);
        expect(yield* userAdapter.count()).toBe(sampleUsers.length);
      }),
    );

    it.effect('utilizes optimized fast path for direct primary key { id } lookups', () =>
      Effect.gen(function* () {
        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(alice));

        const updated = yield* userAdapter.findOneAndUpdate({ id: alice.value.id }, { role: 'fast-path' });
        assert(Option.isSome(updated));
        expect(updated.value.role).toBe('fast-path');
      }),
    );

    it.effect('ignores undefined properties inside update payload objects', () =>
      Effect.gen(function* () {
        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(alice));

        const updated = yield* userAdapter.findOneAndUpdate({ id: alice.value.id }, { role: undefined, bio: undefined });
        assert(Option.isSome(updated));
        expect(updated.value).toEqual(alice.value);
      }),
    );

    it.effect('prevents undefined payload values from overwriting filter criteria during upserts', () =>
      Effect.gen(function* () {
        const created = yield* userAdapter.findOneAndUpdate(
          { email: 'undef@example.com', name: 'From Filter' },
          { name: undefined, age: 44 },
          { upsert: true },
        );
        assert(Option.isSome(created));
        expect(created.value.name).toBe('From Filter');
        expect(created.value.age).toBe(44);
      }),
    );

    it.effect('honors select projection when upserting with an empty payload', () =>
      Effect.gen(function* () {
        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(alice));

        const projected = yield* userAdapter.findOneAndUpdate({ email: 'alice@example.com' }, {}, { upsert: true, select: { name: 1 } });
        assert(Option.isSome(projected));
        expect(projected.value).toEqual({ id: alice.value.id, name: 'Alice' });
      }),
    );

    it.effect('restricts update modification scope strictly to touched payload columns during upsert', () =>
      Effect.gen(function* () {
        const readTouched = watchUpdatedColumns(['id', 'name', 'email', 'age', 'role', 'bio']);

        const updated = yield* userAdapter.findOneAndUpdate({ email: 'alice@example.com' }, { bio: 'Rewritten bio' }, { upsert: true });
        assert(Option.isSome(updated));
        expect(updated.value.bio).toBe('Rewritten bio');
        expect(updated.value.name).toBe('Alice');
        expect(readTouched()).toEqual(['bio']);
      }),
    );

    it.effect('restricts modified columns strictly to payload properties during plain findOneAndUpdate', () =>
      Effect.gen(function* () {
        const readTouched = watchUpdatedColumns(['id', 'name', 'email', 'age', 'role', 'bio']);

        yield* userAdapter.findOneAndUpdate({ email: 'bob@example.com' }, { age: 25 });
        expect(readTouched()).toEqual(['age']);
      }),
    );

    it.effect('applies select projection when findOneAndUpdate payload is empty', () =>
      Effect.gen(function* () {
        const projected = yield* userAdapter.findOneAndUpdate({ email: 'alice@example.com' }, {}, { select: { name: 1 } });
        assert(Option.isSome(projected));
        expect(Object.keys(projected.value).sort()).toEqual(['id', 'name']);
      }),
    );
  });

  describe('findOneAndDelete Operations', () => {
    it.effect('deletes matching record and returns deleted payload wrapped in Option.some', () =>
      Effect.gen(function* () {
        const trentOpt = yield* userAdapter.findOne({ email: 'trent@example.com' });
        assert(Option.isSome(trentOpt), 'Expected Trent to be found');
        const trent = trentOpt.value;

        const initialCount = yield* userAdapter.count();

        const deletedUserOpt = yield* userAdapter.findOneAndDelete({ email: 'trent@example.com' });
        expectTypeOf(deletedUserOpt).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(deletedUserOpt)).toBe(true);
        if (Option.isSome(deletedUserOpt)) {
          expect(deletedUserOpt.value.id).toBe(trent.id);
          expect(deletedUserOpt.value.name).toBe(trent.name);
        }

        expect(Option.isNone(yield* userAdapter.findOne({ id: trent.id }))).toBe(true);
        const currentCount = yield* userAdapter.count();
        expect(currentCount).toBe(initialCount - 1);
      }),
    );

    it.effect('returns Option.none when no record matches delete filter', () =>
      Effect.gen(function* () {
        const user = yield* userAdapter.findOneAndDelete({ email: 'ghost@example.com' });
        expectTypeOf(user).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isNone(user)).toBe(true);
      }),
    );

    it.effect('returns Option.none when executing findOneAndDelete against an empty table', () =>
      Effect.gen(function* () {
        client.exec('DELETE FROM users;');
        const user = yield* userAdapter.findOneAndDelete({ name: 'AnyName' });
        expectTypeOf(user).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isNone(user)).toBe(true);
      }),
    );

    it.effect('applies selection projection to deleted records returned by findOneAndDelete', () =>
      Effect.gen(function* () {
        const ursulaOpt = yield* userAdapter.findOne({ email: 'ursula@example.com' });
        assert(Option.isSome(ursulaOpt), 'Expected Ursula to be found');
        const ursula = ursulaOpt.value;

        const deletedUser = yield* userAdapter.findOneAndDelete({ email: 'ursula@example.com' }, { select: { id: 1, name: 1, email: 1 } });
        expectTypeOf(deletedUser).toEqualTypeOf<Option.Option<{ id: number; name: string; email: string | null }>>();
        expect(Option.isSome(deletedUser)).toBe(true);
        if (Option.isSome(deletedUser)) {
          expect(deletedUser.value).toEqual({ id: ursula.id, name: 'Ursula User', email: 'ursula@example.com' });
        }
      }),
    );

    it.effect('deletes only the first matching record in multi-match queries according to ordering', () =>
      Effect.gen(function* () {
        const usersAge30 = sampleUsers.filter((u) => u.age === 30);
        expect(usersAge30.length).toBeGreaterThan(1);

        const initialAge30Users = yield* userAdapter.find({ age: 30 }, { order: { id: 'asc' } });
        const firstUserId = initialAge30Users[0].id;
        const firstUserName = initialAge30Users[0].name;

        const deletedUserOpt = yield* userAdapter.findOneAndDelete({ age: 30 }, { order: { id: 'asc' } });
        expectTypeOf(deletedUserOpt).toEqualTypeOf<Option.Option<User>>();
        expect(Option.isSome(deletedUserOpt)).toBe(true);
        if (Option.isSome(deletedUserOpt)) {
          expect(deletedUserOpt.value.id).toBe(firstUserId);
          expect(deletedUserOpt.value.name).toBe(firstUserName);
        }

        expect(Option.isNone(yield* userAdapter.findOne({ id: firstUserId }))).toBe(true);
        expect(yield* userAdapter.count({ age: 30 })).toBe(initialAge30Users.length - 1);
      }),
    );

    it.effect('deletes the first row deterministically when no explicit ordering is specified', () =>
      Effect.gen(function* () {
        const age30 = yield* userAdapter.find({ age: 30 }, { order: { id: 'asc' } });
        expect(age30.length).toBeGreaterThan(1);

        const deleted = yield* userAdapter.findOneAndDelete({ age: 30 });
        assert(Option.isSome(deleted));
        expect(deleted.value.id).toBe(age30[0].id);
      }),
    );
  });
});

describe('Data Type Marshalling & Custom Column Types', () => {
  describe('Column Encoding & Value Marshalling', () => {
    const seedTyped = () =>
      typedAdapter.insert([
        { label: 'alpha', occurredAt: DATE_A, active: true, payload: Buffer.from('alpha-blob'), meta: { tag: 'first' } },
        { label: 'beta', occurredAt: DATE_B, active: false, payload: Buffer.from('beta-blob'), meta: { tag: 'second' } },
        { label: 'gamma', occurredAt: null, active: null, payload: null, meta: null },
      ]);

    it.effect('binds Date objects as literal comparison values rather than operator objects', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const exact = yield* typedAdapter.find({ occurredAt: DATE_A });
        expectTypeOf(exact).toEqualTypeOf<Typed[]>();
        expect(exact.map((r) => r.label)).toEqual(['alpha']);
        expect(exact[0].occurredAt).toBeInstanceOf(Date);
        expect(exact[0].occurredAt!.getTime()).toBe(DATE_A.getTime());
      }),
    );

    it.effect('supports comparison operators against custom Date column values', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const after = yield* typedAdapter.find({ occurredAt: { $gt: DATE_A } });
        expect(after.map((r) => r.label)).toEqual(['beta']);

        const range = yield* typedAdapter.find({ occurredAt: { $gte: DATE_A, $lte: DATE_B } }, { order: { occurredAt: 'asc' } });
        expect(range.map((r) => r.label)).toEqual(['alpha', 'beta']);

        const nulls = yield* typedAdapter.find({ occurredAt: { $null: true } });
        expect(nulls.map((r) => r.label)).toEqual(['gamma']);
      }),
    );

    it.effect('binds Buffer binary objects as literal comparison values', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const found = yield* typedAdapter.find({ payload: Buffer.from('beta-blob') });
        expect(found.map((r) => r.label)).toEqual(['beta']);
        expect(Buffer.isBuffer(found[0].payload)).toBe(true);
      }),
    );

    it.effect('marshals JavaScript boolean values to SQLite integer flags (1 and 0)', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const active = yield* typedAdapter.find({ active: true });
        expect(active.map((r) => r.label)).toEqual(['alpha']);

        const inactive = yield* typedAdapter.find({ active: false });
        expect(inactive.map((r) => r.label)).toEqual(['beta']);

        const raw = client.prepare('SELECT active FROM typed_table WHERE label = ?').get('alpha') as { active: number };
        expect(raw.active).toBe(1);
      }),
    );

    it.effect('marshals plain JavaScript objects to JSON column string values', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const found = yield* typedAdapter.find({ meta: { tag: 'second' } });
        expect(found.map((r) => r.label)).toEqual(['beta']);
        expect(found[0].meta).toEqual({ tag: 'second' });
      }),
    );

    it.effect('honors query operators when used on custom typed table columns', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const found = yield* typedAdapter.find({ label: { $in: ['alpha', 'gamma'] } }, { order: { label: 'asc' } });
        expect(found.map((r) => r.label)).toEqual(['alpha', 'gamma']);
      }),
    );

    it.effect('encodes Date operands through column mappers for $like and $nlike operators', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const exit = yield* Effect.exit(typedAdapter.find({ occurredAt: { $like: DATE_A as never } }));
        assert(Exit.isSuccess(exit));
        expect(exit.value).toHaveLength(0);

        const negated = yield* typedAdapter.find({ occurredAt: { $nlike: DATE_A as never } }, { order: { label: 'asc' } });
        expect(negated.map((r) => r.label)).toEqual(['alpha', 'beta']);
      }),
    );

    it.effect('encodes boolean operands through column mappers for $glob and $nglob operators', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const exit = yield* Effect.exit(typedAdapter.find({ active: { $glob: true as never } }));
        assert(Exit.isSuccess(exit));
        expect(exit.value).toHaveLength(0);

        const negated = yield* Effect.exit(typedAdapter.find({ active: { $nglob: true as never } }));
        assert(Exit.isSuccess(negated));
      }),
    );

    it.effect('evaluates pattern operators against serialized JSON string representations', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const exact = yield* typedAdapter.find({ meta: { $glob: { tag: 'second' } as never } });
        expect(exact.map((r) => r.label)).toEqual(['beta']);

        const byLike = yield* typedAdapter.find({ meta: { $like: { tag: 'first' } as never } });
        expect(byLike.map((r) => r.label)).toEqual(['alpha']);
      }),
    );

    it.effect('preserves Buffer BLOB operands across all pattern operator expressions', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const exit = yield* Effect.exit(typedAdapter.find({ payload: { $glob: Buffer.from('alpha-blob') as never } }));
        assert(Exit.isSuccess(exit));
      }),
    );

    it.effect('evaluates pattern operators on standard TEXT columns without value transformation', () =>
      Effect.gen(function* () {
        const starts = yield* userAdapter.find({ name: { $like: 'A%' } }, { order: { name: 'asc' } });
        expect(starts.map((u) => u.name)).toEqual(['Alice']);

        const globbed = yield* userAdapter.find({ name: { $glob: '*e' } }, { order: { name: 'asc' } });
        expect(globbed.map((u) => u.name)).toEqual(['Alice', 'Charlie', 'Eve']);

        const notGlobbed = yield* userAdapter.find({ name: { $nglob: '*e' } }, { order: { name: 'asc' } });
        expect(notGlobbed.map((u) => u.name)).toEqual(['Bob', 'David', 'Mallory', 'Trent', 'Ursula User']);
      }),
    );

    it.effect('consistently encodes Date objects across all comparator operators ($eq, $in, ranges)', () =>
      Effect.gen(function* () {
        yield* seedTyped();

        const byEq = yield* typedAdapter.find({ occurredAt: { $eq: DATE_A } });
        const byIn = yield* typedAdapter.find({ occurredAt: { $in: [DATE_A] } });
        const byRange = yield* typedAdapter.find({ occurredAt: { $gte: DATE_A, $lte: DATE_A } });

        expect(byEq.map((r) => r.label)).toEqual(['alpha']);
        expect(byIn.map((r) => r.label)).toEqual(['alpha']);
        expect(byRange.map((r) => r.label)).toEqual(['alpha']);
      }),
    );
  });

  describe('Storage Classes & Type Affinity', () => {
    it.effect('applies numeric affinity when comparing numeric strings against INTEGER columns', () =>
      Effect.gen(function* () {
        const expected = sampleUsers.filter((u) => u.age === 30).length;
        const users = yield* userAdapter.find({ age: '30' as never });
        expect(users).toHaveLength(expected);
      }),
    );

    it.effect('prevents numeric values from matching TEXT columns under strict type affinity', () =>
      Effect.gen(function* () {
        yield* userAdapter.insert({ name: '42', email: 'fortytwo@example.com' });

        expect(yield* userAdapter.find({ name: 42 as never })).toHaveLength(0);
        expect(yield* userAdapter.find({ name: '42' })).toHaveLength(1);
      }),
    );

    it.effect('sorts TEXT columns lexicographically while INTEGER columns sort numerically', () =>
      Effect.gen(function* () {
        yield* postAdapter.insert([
          { title: '2', views: 2 },
          { title: '10', views: 10 },
        ]);

        const byTitle = yield* postAdapter.find({ title: { $in: ['2', '10'] } }, { order: { title: 'asc' } });
        expect(byTitle.map((p) => p.title)).toEqual(['10', '2']);

        const byViews = yield* postAdapter.find({ views: { $in: [2, 10] } }, { order: { views: 'asc' } });
        expect(byViews.map((p) => p.views)).toEqual([2, 10]);
      }),
    );

    it.effect('treats underscore "_" inside LIKE patterns as a wildcard character', () =>
      Effect.gen(function* () {
        yield* userAdapter.insert([
          { name: 'a_b', email: 'underscore@example.com' },
          { name: 'axb', email: 'wildcard@example.com' },
        ]);

        const users = yield* userAdapter.find({ name: { $like: 'a_b' } }, { order: { name: 'asc' } });
        expect(users.map((u) => u.name)).toEqual(['a_b', 'axb']);
      }),
    );

    it.effect('applies ASCII case-insensitivity to LIKE while enforcing case-sensitivity for GLOB', () =>
      Effect.gen(function* () {
        yield* userAdapter.insert({ name: 'Emile', email: 'emile@example.com' });

        expect((yield* userAdapter.find({ name: { $like: 'emILE' } })).map((u) => u.name)).toEqual(['Emile']);
        expect((yield* userAdapter.find({ name: { $glob: 'emile' } })).map((u) => u.name)).toEqual([]);
        expect((yield* userAdapter.find({ name: { $glob: 'Emile' } })).map((u) => u.name)).toEqual(['Emile']);
      }),
    );

    it.effect('supports single-character "?" and character class bracket wildcards in GLOB patterns', () =>
      Effect.gen(function* () {
        const single = yield* userAdapter.find({ name: { $glob: '?ob' } });
        expect(single.map((u) => u.name)).toEqual(['Bob']);

        const klass = yield* userAdapter.find({ name: { $glob: '[AB]*' } }, { order: { name: 'asc' } });
        expect(klass.map((u) => u.name)).toEqual(['Alice', 'Bob']);
      }),
    );

    it.effect('permits storing multiple NULL values inside UNIQUE constrained columns', () =>
      Effect.gen(function* () {
        yield* userAdapter.insert([
          { name: 'No Mail One', email: null },
          { name: 'No Mail Two', email: null },
        ]);

        const users = yield* userAdapter.find({ email: null });
        expect(users).toHaveLength(2);
      }),
    );

    it.effect('guarantees AUTOINCREMENT primary key values are never reused following row deletion', () =>
      Effect.gen(function* () {
        const all = yield* userAdapter.find({}, { order: { id: 'desc' } });
        const last = all[0];

        yield* userAdapter.delete(last);
        const inserted = yield* userAdapter.insert({ name: 'After Delete', email: 'afterdelete@example.com' });
        expect(inserted[0].id).toBeGreaterThan(last.id);
      }),
    );

    it.effect('returns pre-trigger state when RETURNING is executed prior to AFTER triggers', () =>
      Effect.gen(function* () {
        client.exec("CREATE TRIGGER users_bump AFTER UPDATE OF name ON users BEGIN UPDATE users SET bio = 'set by trigger' WHERE id = NEW.id; END;");

        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        assert(Option.isSome(alice));

        const updated = yield* userAdapter.update({ id: alice.value.id, name: 'Alice Triggered' } as User);
        expect(updated[0].bio).toBe(alice.value.bio);

        const stored = yield* userAdapter.findOne({ id: alice.value.id });
        assert(Option.isSome(stored));
        expect(stored.value.bio).toBe('set by trigger');
      }),
    );

    it.effect('fails with SQLITE_MAX_VARIABLE_NUMBER error when batch insert parameters exceed limits', () =>
      Effect.gen(function* () {
        const rows = Array.from({ length: 12_000 }, (_, i) => ({ name: `bulk-${i}`, email: `bulk-${i}@example.com`, bio: `bio-${i}` }));

        const exit = yield* Effect.exit(userAdapter.insert(rows));
        assert(Exit.isFailure(exit));
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/too many SQL variables/i);

        const smaller = yield* userAdapter.insert(rows.slice(0, 1_000));
        expect(smaller).toHaveLength(1_000);
      }),
    );
  });
});

describe('Transaction Management & Concurrency', () => {
  class BusinessError extends Data.TaggedError('BusinessError')<{ readonly reason: string }> {}

  describe('Transaction Execution & Rollback Semantics', () => {
    it.effect('commits all database mutations when transaction closure effect succeeds', () =>
      Effect.gen(function* () {
        const result = yield* userAdapter.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert({ name: 'Tx One', email: 'tx1@example.com' });
            yield* tx.insert({ name: 'Tx Two', email: 'tx2@example.com' });
            return yield* tx.count();
          }),
        );

        expect(result).toBe(sampleUsers.length + 2);
        expect(yield* userAdapter.count()).toBe(sampleUsers.length + 2);
      }),
    );

    it.effect('rolls back all mutations and preserves typed domain errors when transaction effect fails', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          userAdapter.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.insert({ name: 'Rolled Back', email: 'rollback@example.com' });
              return yield* new BusinessError({ reason: 'nope' });
            }),
          ),
        );

        assert(Exit.isFailure(exit));
        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        expect(failure.value).toBeInstanceOf(BusinessError);
        expect((failure.value as BusinessError).reason).toBe('nope');

        expect(Option.isNone(yield* userAdapter.findOne({ email: 'rollback@example.com' }))).toBe(true);
        expect(yield* userAdapter.count()).toBe(sampleUsers.length);
      }),
    );

    it.effect('rolls back mutations and preserves SqliteClientError on database constraint failure', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          userAdapter.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.insert({ name: 'Tx Ok', email: 'txok@example.com' });
              return yield* tx.insert({ name: 'Tx Dup', email: 'alice@example.com' });
            }),
          ),
        );

        assert(Exit.isFailure(exit));
        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        expect(failure.value).toBeInstanceOf(SqliteClientError);
        expect((failure.value as SqliteClientError).message).toMatch(/UNIQUE constraint failed: users.email/i);

        expect(Option.isNone(yield* userAdapter.findOne({ email: 'txok@example.com' }))).toBe(true);
      }),
    );

    it.effect('supports nested transaction scopes via SQL savepoints', () =>
      Effect.gen(function* () {
        const result = yield* userAdapter.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert({ name: 'Outer', email: 'outer@example.com' });

            const inner = yield* Effect.exit(
              tx.transaction((nested) =>
                Effect.gen(function* () {
                  yield* nested.insert({ name: 'Inner', email: 'inner@example.com' });
                  return yield* new BusinessError({ reason: 'inner failed' });
                }),
              ),
            );

            expect(Exit.isFailure(inner)).toBe(true);
            return yield* tx.count();
          }),
        );

        expect(result).toBe(sampleUsers.length + 1);
        expect(Option.isSome(yield* userAdapter.findOne({ email: 'outer@example.com' }))).toBe(true);
        expect(Option.isNone(yield* userAdapter.findOne({ email: 'inner@example.com' }))).toBe(true);
      }),
    );

    it.effect('exposes transaction-bound adapter instances within transaction closure contexts', () =>
      Effect.gen(function* () {
        const found = yield* userAdapter.transaction((tx) => tx.findOne({ email: 'alice@example.com' }));
        assert(Option.isSome(found));
        expect(found.value.name).toBe('Alice');
      }),
    );

    it.effect('rolls back transactions when asynchronous effects are attempted', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          userAdapter.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.insert({ name: 'Async', email: 'async@example.com' });
              yield* Effect.sleep('1 millis');
            }),
          ),
        );

        assert(Exit.isFailure(exit));
        expect(Cause.isDie(exit.cause) || Option.isSome(Cause.failureOption(exit.cause))).toBe(true);
        expect(Option.isNone(yield* userAdapter.findOne({ email: 'async@example.com' }))).toBe(true);
      }),
    );

    it.effect('retains outer transaction updates when nested savepoint transactions abort', () =>
      Effect.gen(function* () {
        yield* userAdapter.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert({ name: 'Kept', email: 'kept@example.com' });

            const inner = yield* Effect.exit(
              tx.transaction((nested) =>
                Effect.gen(function* () {
                  yield* nested.findOneAndUpdate({ email: 'kept@example.com' }, { role: 'inner' });
                  return yield* nested.insert({ name: 'Dup', email: 'alice@example.com' });
                }),
              ),
            );

            expect(Exit.isFailure(inner)).toBe(true);
          }),
        );

        const kept = yield* userAdapter.findOne({ email: 'kept@example.com' });
        assert(Option.isSome(kept));
        expect(kept.value.role).toBe('user');
      }),
    );
  });

  describe('Transaction Isolation & Lock Behavior (WAL)', () => {
    const itemsTable = sqliteTable('items', {
      id: integer('id').primaryKey({ autoIncrement: true }),
      v: text('v').notNull(),
    });

    let dir: string;
    let writer: Database.Database;
    let outsider: Database.Database;
    let itemAdapter: Adapter<typeof itemsTable>;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'yoru-sqlite-'));
      writer = new Database(join(dir, 'tx.db'));
      writer.pragma('journal_mode = WAL');
      writer.pragma('busy_timeout = 50');
      writer.exec('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL)');

      outsider = new Database(join(dir, 'tx.db'));
      outsider.pragma('busy_timeout = 50');

      itemAdapter = Adapter(drizzle(writer), itemsTable);
    });

    afterEach(() => {
      writer.close();
      outsider.close();
      rmSync(dir, { recursive: true, force: true });
    });

    const writeFromOutside = (v: string): string => {
      try {
        outsider.prepare('INSERT INTO items (v) VALUES (?)').run(v);
        return 'ok';
      } catch (error) {
        return (error as Error).message;
      }
    };

    it('fails deferred transaction with database locked when snapshot is invalidated by concurrent writer', () => {
      let outside = '';
      const exit = Effect.runSyncExit(
        itemAdapter.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.count();
            outside = writeFromOutside('outside');
            return yield* tx.insert({ v: 'inside' });
          }),
        ),
      );

      expect(outside).toBe('ok');
      assert(Exit.isFailure(exit));
      const failure = Cause.failureOption(exit.cause);
      assert(Option.isSome(failure));
      expect((failure.value as SqliteClientError).message).toMatch(/database is locked/i);
    });

    it('acquires write lock immediately under immediate transaction behavior preventing concurrent writes', () => {
      let outside = '';
      const exit = Effect.runSyncExit(
        itemAdapter.transaction(
          (tx) =>
            Effect.gen(function* () {
              yield* tx.count();
              outside = writeFromOutside('outside');
              return yield* tx.insert({ v: 'inside' });
            }),
          { behavior: 'immediate' },
        ),
      );

      expect(outside).toMatch(/database is locked/i);
      assert(Exit.isSuccess(exit));
      expect(exit.value[0].v).toBe('inside');
      expect(writer.prepare('SELECT COUNT(*) AS n FROM items').get()).toEqual({ n: 1 });
    });

    it('executes atomic findOneAndUpdate upserts inside immediate transactions to prevent concurrency conflicts', () => {
      const exit = Effect.runSyncExit(itemAdapter.findOneAndUpdate({ v: 'seed' }, { v: 'upserted' }, { upsert: true }));

      assert(Exit.isSuccess(exit));
      assert(Option.isSome(exit.value));
      expect(exit.value.value.v).toBe('upserted');
    });
  });
});

describe('Infrastructure, Diagnostics & Resource Management', () => {
  describe('SqliteClientLayer & Connection Lifecycle', () => {
    const withClient = <A>(options: Parameters<typeof makeSqliteConfig>[0], use: (db: BetterSQLite3Database) => A) =>
      Effect.runPromiseExit(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const client = yield* SqliteClientTag;
              return use(client);
            }),
            Layer.provide(SqliteClientLayer, Layer.succeed(SqliteConfigTag, makeSqliteConfig(options))),
          ),
        ),
      );

    it('initializes migrated SQLite database connection applying configured pragmas', async () => {
      const exit = await withClient({ dbCredentials: { url: ':memory:' } }, (db) => ({
        tables: db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' order by name`).map((r) => r.name),
        foreignKeys: db.get<{ foreign_keys: number }>(sql`pragma foreign_keys`),
        busyTimeout: db.get<{ timeout: number }>(sql`pragma busy_timeout`),
      }));

      assert(Exit.isSuccess(exit));
      expect(exit.value.tables).toEqual(expect.arrayContaining(['account', 'user']));
      expect(exit.value.foreignKeys).toEqual({ foreign_keys: 1 });
      expect(exit.value.busyTimeout).toEqual({ timeout: 5000 });
    });

    it('applies custom busy timeout configurations to the active SQLite connection', async () => {
      const exit = await withClient({ dbCredentials: { url: ':memory:' }, busyTimeout: 250 }, (db) =>
        db.get<{ timeout: number }>(sql`pragma busy_timeout`),
      );

      assert(Exit.isSuccess(exit));
      expect(exit.value).toEqual({ timeout: 250 });
    });

    it('executes adapter operations against the initialized Layer schema', async () => {
      const exit = await withClient({ dbCredentials: { url: ':memory:' } }, (db) => {
        const table = sqliteTable('user', {
          id: integer('id').primaryKey({ autoIncrement: true }),
          ownerId: text('owner_id').notNull().unique(),
        });

        const adapter = Adapter(db, table);
        return Effect.runSync(
          Effect.gen(function* () {
            yield* adapter.insert({ ownerId: 'owner-1' });
            return yield* adapter.findOne({ ownerId: 'owner-1' });
          }),
        );
      });

      assert(Exit.isSuccess(exit));
      assert(Option.isSome(exit.value));
      expect(exit.value.value.ownerId).toBe('owner-1');
    });

    it('closes the SQLite database connection automatically when Effect scope releases', async () => {
      let handle: BetterSQLite3Database | undefined;
      const exit = await withClient({ dbCredentials: { url: ':memory:' } }, (db) => {
        handle = db;
        return true;
      });

      assert(Exit.isSuccess(exit));
      expect(() => handle!.get(sql`select 1`)).toThrow(/not open/i);
    });

    it('fails with SqliteClientError when configured migrations directory is missing', async () => {
      const exit = await withClient({ out: 'migrations-does-not-exist', dbCredentials: { url: ':memory:' } }, () => true);

      assert(Exit.isFailure(exit));
      const failure = Cause.failureOption(exit.cause);
      assert(Option.isSome(failure));
      expect(failure.value).toBeInstanceOf(SqliteClientError);
    });
  });

  describe('SqliteClientError Diagnostics', () => {
    it.effect('attaches compiled SQL statement objects to SqliteClientError failure payloads', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.insert({ email: 'nonull@example.com' } as InsertUser));
        assert(Exit.isFailure(exit));

        const failure = Cause.failureOption(exit.cause);
        assert(Option.isSome(failure));
        const error = failure.value as SqliteClientError;

        expect(error.message).toMatch(/NOT NULL constraint failed: users.name/i);
        expect(error.query).toEqual(expect.objectContaining({ sql: expect.stringContaining('insert into "users"') }));
      }),
    );

    it.effect('reports missing primary key id as a typed SqliteClientError failure during update/delete', () =>
      Effect.gen(function* () {
        const updateExit = yield* Effect.exit(userAdapter.update({ name: 'No Id' } as User));
        assert(Exit.isFailure(updateExit));
        expect(Option.isSome(Cause.failureOption(updateExit.cause))).toBe(true);

        const deleteExit = yield* Effect.exit(userAdapter.delete({ name: 'No Id' } as User));
        assert(Exit.isFailure(deleteExit));
        expect(Option.isSome(Cause.failureOption(deleteExit.cause))).toBe(true);
      }),
    );

    it.effect('reports invalid join condition specifications as typed errors', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.find({}, { joins: [{ table: officesTable, on: {}, type: 'left' }] }));
        assert(Exit.isFailure(exit));
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/Join conditions \(on\) must be specified/i);
      }),
    );

    it.effect('reports unknown join column keys as typed errors', () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(userAdapter.find({}, { joins: [{ table: officesTable, on: { officeId: 'nope' as never } }] }));
        assert(Exit.isFailure(exit));
        // @ts-expect-error Internal effect access.
        expect(exit.cause.error.message).toMatch(/Invalid join keys/i);
      }),
    );
  });
});

describe('Static Contract Verification & Type Safety', () => {
  const pin = (_query: unknown): void => void 0;

  class ComptimeBoom extends Data.TaggedError('ComptimeBoom')<{}> {}

  it('validates static TypeScript type constraints on query filter surfaces', () => {
    pin(userAdapter.find({ name: 'Alice', age: { $gte: 18 }, bio: { $null: true } }));
    pin(userAdapter.find({ $or: [{ role: 'admin' }, { $and: [{ age: { $lt: 25 } }, { name: { $like: 'B%' } }] }] }));
    pin(userAdapter.find({ $not: { role: 'admin' } }));
    pin(userAdapter.find({ email: null, age: { $in: [1, 2] } }));

    // @ts-expect-error `nope` is not a column of `users`.
    pin(userAdapter.find({ nope: 'x' }));
    // @ts-expect-error `age` is an integer column, not a string one.
    pin(userAdapter.find({ age: 'thirty' }));
    // @ts-expect-error `$in` takes an array of the column type.
    pin(userAdapter.find({ role: { $in: 'admin' } }));
    // @ts-expect-error `$bogus` is not a comparison operator.
    pin(userAdapter.find({ role: { $bogus: 'admin' } }));
    // @ts-expect-error `$and` takes an array of filters.
    pin(userAdapter.find({ $and: { role: 'admin' } }));
    // @ts-expect-error `$null` is a boolean flag, not a value.
    pin(userAdapter.find({ bio: { $null: 'yes' } }));
  });

  it('validates static TypeScript type constraints on selection projection options', () => {
    pin(userAdapter.find({}, { select: { name: 1, bio: 0 } }));
    pin(userAdapter.find({}, { joins: [{ table: officesTable, on: { officeId: 'id' } }], select: { location: 1 } }));

    // @ts-expect-error unknown projection keys are rejected.
    pin(userAdapter.find({}, { select: { nope: 1 } }));
    // @ts-expect-error projection flags are 0 or 1.
    pin(userAdapter.find({}, { select: { name: true } }));
    // @ts-expect-error a joined column cannot be projected without the join.
    pin(userAdapter.find({}, { select: { location: 1 } }));
  });

  it('validates static TypeScript type constraints on order sorting options', () => {
    pin(userAdapter.find({}, { order: { name: 'asc', age: 'desc' } }));

    // @ts-expect-error only 'asc' and 'desc' are valid directions.
    pin(userAdapter.find({}, { order: { name: 'ascending' } }));
    // @ts-expect-error unknown order keys are rejected.
    pin(userAdapter.find({}, { order: { nope: 'asc' } }));
  });

  it('validates static TypeScript type constraints on relational join configurations', () => {
    pin(userAdapter.find({}, { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'left' }] }));

    // @ts-expect-error `nope` is not a column of `users`.
    pin(userAdapter.find({}, { joins: [{ table: officesTable, on: { nope: 'id' } }] }));
    // @ts-expect-error `nope` is not a column of `offices`.
    pin(userAdapter.find({}, { joins: [{ table: officesTable, on: { officeId: 'nope' } }] }));
    // @ts-expect-error `outer` is not a supported join type.
    pin(userAdapter.find({}, { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'outer' }] }));
  });

  it.effect('enforces join type nullability inside static return type signatures', () =>
    Effect.gen(function* () {
      const inner = yield* userAdapter.find({}, { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'inner' }] });
      expectTypeOf(inner).toEqualTypeOf<Array<{ readonly users: User } & { readonly offices: Office }>>();

      const left = yield* userAdapter.find({}, { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'left' }] });
      expectTypeOf(left).toEqualTypeOf<Array<{ readonly users: User } & { readonly offices: Office | null }>>();

      const right = yield* userAdapter.find({}, { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'right' }] });
      expectTypeOf(right).toEqualTypeOf<Array<{ readonly users: User | null } & { readonly offices: Office }>>();

      const full = yield* userAdapter.find({}, { joins: [{ table: officesTable, on: { officeId: 'id' }, type: 'full' }] });
      expectTypeOf(full).toEqualTypeOf<Array<{ readonly users: User | null } & { readonly offices: Office | null }>>();
    }),
  );

  it('validates static TypeScript type constraints on insertion payloads and conflict options', () => {
    pin(userAdapter.insert({ name: 'A', email: 'a@e.com' }));
    pin(userAdapter.insert([{ name: 'A' }, { name: 'B' }]));
    pin(userAdapter.insert({ name: 'A' }, { conflict: { resolution: 'ignore', target: ['email'] } }));

    // @ts-expect-error the primary key is assigned by SQLite, never by the caller.
    pin(userAdapter.insert({ id: 1, name: 'A' }));
    // @ts-expect-error `name` is NOT NULL without a default, so it is required.
    pin(userAdapter.insert({ email: 'a@e.com' }));
    // @ts-expect-error `nope` is not a column of `users`.
    pin(userAdapter.insert({ name: 'A', nope: 1 }));
    // @ts-expect-error conflict targets are column names of the table.
    pin(userAdapter.insert({ name: 'A' }, { conflict: { resolution: 'ignore', target: ['nope'] } }));
    // @ts-expect-error only the three documented resolutions exist.
    pin(userAdapter.insert({ name: 'A' }, { conflict: { resolution: 'replace', target: ['email'] } }));
  });

  it('validates static TypeScript type constraints on update and delete entity payloads', () => {
    const row = { id: 1, name: 'A', email: null, age: null, role: null, officeId: null, bio: null } satisfies User;
    pin(userAdapter.update(row));
    pin(userAdapter.delete(row));

    // @ts-expect-error `update` takes a full select row, so `id` cannot be missing.
    pin(userAdapter.update({ name: 'A' }));
    // @ts-expect-error `delete` takes a full select row, so `id` cannot be missing.
    pin(userAdapter.delete({ name: 'A' }));
  });

  it('validates static TypeScript type constraints on findOneAndUpdate options and upserts', () => {
    pin(userAdapter.findOneAndUpdate({ email: 'a@e.com' }, { name: 'A' }, { upsert: true }));
    pin(userAdapter.findOneAndUpdate({ age: { $gt: 30 } }, { name: 'A' }));

    // @ts-expect-error operator filters are not allowed together with `upsert: true`.
    pin(userAdapter.findOneAndUpdate({ age: { $gt: 30 } }, { name: 'A' }, { upsert: true }));
    // @ts-expect-error the update payload may never carry the primary key.
    pin(userAdapter.findOneAndUpdate({ email: 'a@e.com' }, { id: 2 }));
    // @ts-expect-error `findOneAndUpdate` has no `limit` option.
    pin(userAdapter.findOneAndUpdate({ email: 'a@e.com' }, { name: 'A' }, { limit: 1 }));
    // @ts-expect-error `findOneAndUpdate` has no `joins` option.
    pin(userAdapter.findOneAndUpdate({ email: 'a@e.com' }, { name: 'A' }, { joins: [] }));
  });

  it('verifies static Effect error and success type channels across adapter methods', () => {
    expectTypeOf(userAdapter.count()).toEqualTypeOf<Effect.Effect<number, SqliteClientError>>();
    expectTypeOf(userAdapter.find()).toEqualTypeOf<Effect.Effect<User[], SqliteClientError>>();
    expectTypeOf(userAdapter.findOne()).toEqualTypeOf<Effect.Effect<Option.Option<User>, SqliteClientError>>();
    expectTypeOf(userAdapter.insert({ name: 'A' })).toEqualTypeOf<Effect.Effect<User[], SqliteClientError>>();
    expectTypeOf(userAdapter.findOneAndDelete()).toEqualTypeOf<Effect.Effect<Option.Option<User>, SqliteClientError>>();

    const tx = userAdapter.transaction(() => Effect.fail(new ComptimeBoom()));
    expectTypeOf(tx).toEqualTypeOf<Effect.Effect<never, SqliteClientError | ComptimeBoom, never>>();

    const withReq = userAdapter.transaction(() => Effect.map(SqliteClientTag, () => 1));
    expectTypeOf(withReq).toEqualTypeOf<Effect.Effect<number, SqliteClientError, SqliteClientTag>>();
  });

  it('validates static TypeScript type constraints on transaction execution behavior options', () => {
    pin(userAdapter.transaction(() => Effect.succeed(1), { behavior: 'immediate' }));
    pin(userAdapter.transaction(() => Effect.succeed(1), { behavior: 'deferred' }));
    pin(userAdapter.transaction(() => Effect.succeed(1), { behavior: 'exclusive' }));

    // @ts-expect-error only the three SQLite transaction behaviours exist.
    pin(userAdapter.transaction(() => Effect.succeed(1), { behavior: 'batch' }));
  });
});
