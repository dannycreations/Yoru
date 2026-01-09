import { it as itBase } from '@effect/vitest';
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { Effect, Exit } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf } from 'vitest';

import { Adapter, BetterSQLite3Database, Database, drizzle, patchDialect, SqliteTag } from '.';

const it = Object.assign((...args: Parameters<typeof itBase>) => itBase(...args), itBase) as any;

it.effect = (name: string, self: () => Effect.Effect<void, never>, timeout?: number) =>
  itBase.effect(name, () => Effect.provideService(self(), SqliteTag, db), timeout);

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

beforeAll(() => {
  client = new Database(':memory:');
  db = drizzle(client);
  // @ts-expect-error access internal drizzle dialect
  patchDialect(db.dialect);
});

beforeEach(() => {
  client.exec(`
    DROP TABLE IF EXISTS posts;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS offices;
    DROP TABLE IF EXISTS no_id_table;
    DROP TABLE IF EXISTS unique_pair_table;

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
  `);

  officeAdapter = Adapter(officesTable);
  userAdapter = Adapter(usersTable);
  postAdapter = Adapter(postsTable);
  uniquePairAdapter = Adapter(uniquePairTable);

  Effect.runSync(Effect.provideService(officeAdapter.insert(sampleOffices), SqliteTag, db));
  Effect.runSync(Effect.provideService(userAdapter.insert(sampleUsers), SqliteTag, db));
  Effect.runSync(Effect.provideService(postAdapter.insert(samplePosts), SqliteTag, db));
});

afterAll(() => {
  client.close();
});

describe('Adapter construction', () => {
  it('should instantiate correctly with a valid Drizzle table schema having an "id" column', () => {
    expect(() => Adapter(usersTable)).not.toThrow();
  });

  it('should throw an error if the table schema does not have an "id" column', () => {
    const action = () => Adapter(noIdTable);
    expect(action).toThrow(/^Table "no_id_table" must have a primary key "id"\.?$/);
  });
});

describe('Adapter find()', () => {
  it.effect('should return all records with all columns if no filter or options are provided', () =>
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

  it.effect('should return empty array when finding on an empty table', () =>
    Effect.gen(function* () {
      client.exec('DELETE FROM offices;');
      const offices = yield* officeAdapter.find();
      expectTypeOf(offices).toEqualTypeOf<Office[]>();
      expect(offices).toEqual([]);
    }),
  );

  describe('filter options', () => {
    it.effect('equality: should find users by name', () =>
      Effect.gen(function* () {
        const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        expect(alice).not.toBeNull();
        const users = yield* userAdapter.find({ name: 'Alice' });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toEqual([expect.objectContaining({ id: alice!.id, name: 'Alice' })]);
      }),
    );

    it.effect('equality: should find users by age', () =>
      Effect.gen(function* () {
        const usersAge30 = sampleUsers.filter((u) => u.age === 30);
        const foundUsers = yield* userAdapter.find({ age: 30 });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersAge30.length);
        foundUsers.forEach((user) => expect(user.age).toBe(30));
      }),
    );

    it.effect('equality: should find users with null bio (field IS NULL)', () =>
      Effect.gen(function* () {
        const usersNullBio = sampleUsers.filter((u) => u.bio === null);
        const foundUsers = yield* userAdapter.find({ bio: null });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersNullBio.length);
        foundUsers.forEach((user) => expect(user.bio).toBeNull());
      }),
    );

    it.effect('comparison ($ne): should find users not named Alice (field <> value)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $ne: 'Alice' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.every((u) => u.name !== 'Alice')).toBe(true);
        expect(users).toHaveLength(sampleUsers.length - 1);
      }),
    );

    it.effect('comparison ($ne): should find users with non-null bio (field IS NOT NULL)', () =>
      Effect.gen(function* () {
        const usersNonNullBioCount = sampleUsers.filter((u) => u.bio !== null).length;
        const foundUsers = yield* userAdapter.find({ bio: { $ne: null } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersNonNullBioCount);
        foundUsers.forEach((user) => expect(user.bio).not.toBeNull());
      }),
    );

    it.effect('comparison ($gt): should find users older than 30 (field > value)', () =>
      Effect.gen(function* () {
        const usersOlderThan30Count = sampleUsers.filter((u) => u.age !== null && u.age! > 30).length;
        const foundUsers = yield* userAdapter.find({ age: { $gt: 30 } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersOlderThan30Count);
        foundUsers.forEach((user) => expect(user.age).toBeGreaterThan(30));
      }),
    );

    it.effect('comparison ($gt): age: {$gt: null} should yield empty (SQLite: field > NULL is UNKNOWN/FALSE)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ age: { $gt: null } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('comparison ($gte): should find users age 30 or older (field >= value)', () =>
      Effect.gen(function* () {
        const usersGte30Count = sampleUsers.filter((u) => u.age !== null && u.age! >= 30).length;
        const foundUsers = yield* userAdapter.find({ age: { $gte: 30 } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersGte30Count);
        foundUsers.forEach((user) => expect(user.age).toBeGreaterThanOrEqual(30));
      }),
    );

    it.effect('comparison ($lt): should find users younger than 30 (field < value)', () =>
      Effect.gen(function* () {
        const usersYoungerThan30Count = sampleUsers.filter((u) => u.age !== null && u.age! < 30).length;
        const foundUsers = yield* userAdapter.find({ age: { $lt: 30 } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersYoungerThan30Count);
        foundUsers.forEach((user) => expect(user.age).toBeLessThan(30));
      }),
    );

    it.effect('comparison ($lte): should find users age 30 or younger (field <= value)', () =>
      Effect.gen(function* () {
        const usersLte30Count = sampleUsers.filter((u) => u.age !== null && u.age! <= 30).length;
        const foundUsers = yield* userAdapter.find({ age: { $lte: 30 } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersLte30Count);
        foundUsers.forEach((user) => expect(user.age).toBeLessThanOrEqual(30));
      }),
    );

    it.effect('string ($like): should find users with name starting with A (LIKE pattern)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $like: 'A%' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.every((u) => u.name.startsWith('A'))).toBe(true);
        expect(users).toHaveLength(sampleUsers.filter((u) => u.name.startsWith('A')).length);
      }),
    );

    it.effect('string ($nlike): should find users with name not starting with A (NOT LIKE pattern)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $nlike: 'A%' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.every((u) => !u.name.startsWith('A'))).toBe(true);
        expect(users).toHaveLength(sampleUsers.filter((u) => !u.name.startsWith('A')).length);
      }),
    );

    it.effect('string ($glob): should find users with name ending with e (GLOB pattern)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $glob: '*e' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        const names = users.map((u) => u.name);
        const expectedNames = sampleUsers.filter((u) => u.name.endsWith('e')).map((u) => u.name);
        expect(names.sort()).toEqual(expect.arrayContaining(expectedNames.sort()));
        expect(names).toHaveLength(expectedNames.length);
      }),
    );

    it.effect('string ($nglob): should find users with name not ending with e (NOT GLOB pattern)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $nglob: '*e' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.every((u) => !u.name.endsWith('e'))).toBe(true);
        expect(users).toHaveLength(sampleUsers.filter((u) => !u.name.endsWith('e')).length);
      }),
    );

    it.effect('array ($in): should find users with specific roles (field IN (values))', () =>
      Effect.gen(function* () {
        const targetRoles = ['admin', 'manager'];
        const expectedUsersCount = sampleUsers.filter((u) => u.role !== null && targetRoles.includes(u.role!)).length;
        const foundUsers = yield* userAdapter.find({ role: { $in: targetRoles } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(expectedUsersCount);
        foundUsers.forEach((user) => expect(targetRoles).toContain(user.role));
      }),
    );

    it.effect('array ($in): $in with empty array should return no results (SQLite: field IN () is FALSE)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ role: { $in: [] } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('array ($nin): should find users not in specific roles (field NOT IN (values))', () =>
      Effect.gen(function* () {
        const excludedRoles = ['admin', 'manager'];
        const expectedUsersCount = sampleUsers.filter((u) => u.role !== null && !excludedRoles.includes(u.role!)).length;
        const foundUsers = yield* userAdapter.find({ role: { $nin: excludedRoles } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(expectedUsersCount);
        foundUsers.forEach((user) => expect(excludedRoles).not.toContain(user.role));
      }),
    );

    it.effect('array ($nin): $nin with empty array should return all results (SQLite: field NOT IN () is TRUE)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ role: { $nin: [] } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(sampleUsers.length);
      }),
    );

    it.effect('null check ($null: true): should find users with null age (field IS NULL)', () =>
      Effect.gen(function* () {
        const usersNullAgeCount = sampleUsers.filter((u) => u.age === null).length;
        const foundUsers = yield* userAdapter.find({ age: { $null: true } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersNullAgeCount);
        foundUsers.forEach((u) => expect(u.age).toBeNull());
      }),
    );

    it.effect('null check ($null: false): should find users with non-null age (field IS NOT NULL)', () =>
      Effect.gen(function* () {
        const usersNonNullAgeCount = sampleUsers.filter((u) => u.age !== null).length;
        const foundUsers = yield* userAdapter.find({ age: { $null: false } });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(usersNonNullAgeCount);
        foundUsers.forEach((u) => expect(u.age).not.toBeNull());
      }),
    );

    it.effect('logical ($and): find users with role "user" AND age 24', () =>
      Effect.gen(function* () {
        const bob = sampleUsers.find((u) => u.email === 'bob@example.com')!;
        const foundUsers = yield* userAdapter.find({ $and: [{ role: 'user' }, { age: 24 }] });
        expectTypeOf(foundUsers).toEqualTypeOf<User[]>();
        expect(foundUsers).toHaveLength(1);
        expect(foundUsers[0]).toEqual(expect.objectContaining({ name: bob.name, email: bob.email }));
      }),
    );

    it.effect('logical ($and): with empty array should return all users (evaluates to TRUE)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $and: [] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(sampleUsers.length);
      }),
    );

    it.effect('logical ($or): find users with role "admin" OR age < 25', () =>
      Effect.gen(function* () {
        const expectedUsersCount = sampleUsers.filter((u) => u.role === 'admin' || (u.age !== null && u.age! < 25)).length;
        const users = yield* userAdapter.find({ $or: [{ role: 'admin' }, { age: { $lt: 25 } }] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(expectedUsersCount);
      }),
    );

    it.effect('logical ($or): with empty array should return no users (evaluates to FALSE)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $or: [] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('logical ($not): find users NOT (role "admin")', () =>
      Effect.gen(function* () {
        const expectedUsersCount = sampleUsers.filter((u) => u.role !== 'admin').length;
        const users = yield* userAdapter.find({ $not: { role: 'admin' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(expectedUsersCount);
      }),
    );

    it.effect('logical ($not { $eq: value }): with nullable column, excludes rows where column is NULL', () =>
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

    it.effect('logical ($not { $eq: null }): is equivalent to { $ne: null } or { $null: false }', () =>
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

    it.effect('logical ($nand): users NOT (role "user" AND age 30)', () =>
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

    it.effect('logical ($nand): with empty array should return no users (evaluates to NOT(TRUE) -> FALSE)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $nand: [] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('logical ($nor): users NOT (role "admin" OR age < 25)', () =>
      Effect.gen(function* () {
        const expectedUsersCount = sampleUsers.filter((u) => {
          return u.age != null && !(u.role === 'admin' || u.age < 25);
        }).length;

        const users = yield* userAdapter.find({ $nor: [{ role: 'admin' }, { age: { $lt: 25 } }] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(expectedUsersCount);
      }),
    );

    it.effect('logical ($nor): with empty array should return all users (evaluates to NOT(FALSE) -> TRUE)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ $nor: [] });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(sampleUsers.length);
      }),
    );

    it.effect('filter with unknown column should result in SQL condition "false" by Adapter logic, yielding 0 results', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ unknownColumn: 'test' } as unknown as Partial<User>);
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );
  });

  describe('query options', () => {
    it.effect('select: should return only specified columns (name, email), plus id implicitly', () =>
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

    it.effect('select: should exclude specified columns (bio: 0), id still included', () =>
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

    it.effect('select: should exclude id if explicitly set to 0', () =>
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

    it.effect('select: empty select object should return default columns (all from primary table)', () =>
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

    it.effect('limit: should return only the specified number of records', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { limit: 2 });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(2);
      }),
    );

    it.effect('limit: limit 0 should return no records', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { limit: 0 });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('limit: limit below 0 should return all records', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { limit: -1 });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(8);
      }),
    );

    it.effect('offset: should skip the specified number of records', () =>
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

    it.effect('offset: large offset should return empty array', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { offset: 1000 });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toHaveLength(0);
      }),
    );

    it.effect('limit and offset: should correctly apply both limit and offset', () =>
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

    it.effect('order: should sort by name ascending', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({}, { order: { name: 'asc' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        for (let i = 0; i < users.length - 1; i++) {
          expect(users[i].name.localeCompare(users[i + 1].name)).toBeLessThanOrEqual(0);
        }
      }),
    );

    it.effect('order: should sort by age descending (SQLite default: NULLS LAST for DESC)', () =>
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

    it.effect('order: should sort by age ascending (SQLite default: NULLS FIRST for ASC)', () =>
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

    it.effect('order: multiple columns (role asc, name desc)', () =>
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
  });

  describe('joins', () => {
    it.effect('inner join: users with their offices (users without office should be excluded)', () =>
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

    it.effect('left join: all users, with their offices if present (users without office should have null for office fields)', () =>
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

    it.effect('right join: (emulated by Drizzle) all offices, with their users if present', () =>
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

    it.effect('full join: (emulated by Drizzle) all users and all offices', () =>
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

    it.effect('cross join: users and offices', () =>
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

    it.effect('join with select: select user name and office location', () =>
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

    it.effect('join with filter on main table: users in role "admin" and their office', () =>
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
        const aliceFromDb = yield* userAdapter.findOne({ email: alice.email });
        expect(aliceFromDb).not.toBeNull();

        expect(joinedResult[0].users.id).toBe(aliceFromDb!.id);
        expect(joinedResult[0].offices.name).toBe('HQ');
      }),
    );

    it.effect('join with filter on main table (FK) that implies a filter on joined table', () =>
      Effect.gen(function* () {
        const hqOffice = yield* officeAdapter.findOne({ name: 'HQ' });
        expect(hqOffice).not.toBeNull();

        const usersInHQCount = sampleUsers.filter((u) => u.officeId === hqOffice!.id).length;

        const joinedResult = yield* userAdapter.find(
          { officeId: hqOffice!.id },
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

    it.effect('join with order by joined table column (location asc, NULLS FIRST for SQLite ASC)', () =>
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
  });

  describe('Filter Logic - Advanced', () => {
    it.effect('should handle $eq with case sensitivity for text fields (SQLite default)', () =>
      Effect.gen(function* () {
        const usersLower = yield* userAdapter.find({ name: 'alice' });
        expectTypeOf(usersLower).toEqualTypeOf<User[]>();
        expect(usersLower.filter((u) => u.name === 'alice')).toHaveLength(0);

        const usersUpper = yield* userAdapter.find({ name: 'Alice' });
        expectTypeOf(usersUpper).toEqualTypeOf<User[]>();
        expect(usersUpper.filter((u) => u.name === 'Alice').length).toBeGreaterThan(0);
      }),
    );

    it.effect('should handle $like with case insensitivity for text fields (SQLite default for ASCII)', () =>
      Effect.gen(function* () {
        const users = yield* userAdapter.find({ name: { $like: 'aliCE%' } });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users.some((u) => u.name === 'Alice')).toBe(true);
      }),
    );

    it.effect('should handle $glob with case sensitivity for text fields (SQLite default)', () =>
      Effect.gen(function* () {
        const usersSensitive = yield* userAdapter.find({ name: { $glob: 'A*' } });
        expectTypeOf(usersSensitive).toEqualTypeOf<User[]>();
        expect(usersSensitive.some((u) => u.name === 'Alice')).toBe(true);

        const usersSensitiveFail = yield* userAdapter.find({ name: { $glob: 'a*' } });
        expectTypeOf(usersSensitiveFail).toEqualTypeOf<User[]>();
        expect(usersSensitiveFail.some((u) => u.name === 'Alice')).toBe(false);
      }),
    );

    it.effect('should correctly filter with $lt: null, $lte: null (SQLite: field < NULL is UNKNOWN/FALSE)', () =>
      Effect.gen(function* () {
        const usersLt = yield* userAdapter.find({ age: { $lt: null } });
        expectTypeOf(usersLt).toEqualTypeOf<User[]>();
        expect(usersLt).toHaveLength(0);

        const usersLte = yield* userAdapter.find({ age: { $lte: null } });
        expectTypeOf(usersLte).toEqualTypeOf<User[]>();
        expect(usersLte).toHaveLength(0);
      }),
    );

    it.effect('should handle complex nested logical operators ($and with $or)', () =>
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
  });

  describe('Query Options - Advanced', () => {
    it.effect('select: should allow id: 0 with other fields from joined table', () =>
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
  });
});

describe('Adapter count()', () => {
  it.effect('should return the total number of users without a filter', () =>
    Effect.gen(function* () {
      const count = yield* userAdapter.count();
      expectTypeOf(count).toEqualTypeOf<number>();
      expect(count).toBe(sampleUsers.length);
    }),
  );

  it.effect('should return the count of users matching the filter', () =>
    Effect.gen(function* () {
      const usersAge30Count = sampleUsers.filter((u) => u.age === 30).length;
      const count = yield* userAdapter.count({ age: 30 });
      expectTypeOf(count).toEqualTypeOf<number>();
      expect(count).toBe(usersAge30Count);
    }),
  );

  it.effect('should return 0 if no users match the filter', () =>
    Effect.gen(function* () {
      const count = yield* userAdapter.count({ name: 'NonExistentName' });
      expectTypeOf(count).toEqualTypeOf<number>();
      expect(count).toBe(0);
    }),
  );

  it.effect('should return 0 for count on an empty table', () =>
    Effect.gen(function* () {
      client.exec('DELETE FROM users;');
      const count = yield* userAdapter.count();
      expectTypeOf(count).toEqualTypeOf<number>();
      expect(count).toBe(0);
    }),
  );

  it.effect('should return count with a complex filter', () =>
    Effect.gen(function* () {
      const expectedCount = sampleUsers.filter((u) => u.role === 'user' && u.age != null && u.age < 30).length;
      const count = yield* userAdapter.count({ $and: [{ role: 'user' }, { age: { $lt: 30 } }] });
      expectTypeOf(count).toEqualTypeOf<number>();
      expect(count).toBe(expectedCount);
    }),
  );
});

describe('Adapter findOne()', () => {
  it.effect('should find a single user by filter', () =>
    Effect.gen(function* () {
      const aliceSample = sampleUsers.find((u) => u.email === 'alice@example.com')!;
      const foundUser = yield* userAdapter.findOne({ email: 'alice@example.com' });
      expectTypeOf(foundUser).toEqualTypeOf<User | null>();
      expect(foundUser).not.toBeNull();
      expect(foundUser).toEqual(expect.objectContaining({ name: aliceSample.name, email: aliceSample.email }));
    }),
  );

  it.effect('should return null if no user matches the filter', () =>
    Effect.gen(function* () {
      const foundUser = yield* userAdapter.findOne({ email: 'nonexistent@example.com' });
      expectTypeOf(foundUser).toEqualTypeOf<User | null>();
      expect(foundUser).toBeNull();
    }),
  );

  it.effect('should return null when finding one on an empty table', () =>
    Effect.gen(function* () {
      client.exec('DELETE FROM users;');
      const foundUser = yield* userAdapter.findOne({ name: 'Alice' });
      expectTypeOf(foundUser).toEqualTypeOf<User | null>();
      expect(foundUser).toBeNull();
    }),
  );

  it.effect('should use options like select', () =>
    Effect.gen(function* () {
      const aliceSample = sampleUsers.find((u) => u.email === 'alice@example.com')!;
      const user = yield* userAdapter.findOne({ email: 'alice@example.com' }, { select: { name: 1 } });
      expectTypeOf(user).toEqualTypeOf<{ id: number; name: string } | null>();
      expect(user).not.toBeNull();
      expect(user).toEqual({ id: expect.any(Number), name: aliceSample.name });
      expect(Object.keys(user!).sort()).toEqual(['id', 'name'].sort());
    }),
  );

  it.effect('should respect order option if multiple records match filter (picks first based on order)', () =>
    Effect.gen(function* () {
      const usersAge30 = yield* userAdapter.find({ age: 30 }, { order: { id: 'asc' } });
      expect(usersAge30.length).toBeGreaterThan(0);

      const minIdAge30 = usersAge30[0].id;
      const maxIdAge30 = usersAge30[usersAge30.length - 1].id;

      const userAsc = yield* userAdapter.findOne({ age: 30 }, { order: { id: 'asc' } });
      expectTypeOf(userAsc).toEqualTypeOf<User | null>();
      expect(userAsc).not.toBeNull();
      expect(userAsc!.id).toBe(minIdAge30);

      const userDesc = yield* userAdapter.findOne({ age: 30 }, { order: { id: 'desc' } });
      expectTypeOf(userDesc).toEqualTypeOf<User | null>();
      expect(userDesc).not.toBeNull();
      expect(userDesc!.id).toBe(maxIdAge30);
    }),
  );

  it.effect('should work with joins', () =>
    Effect.gen(function* () {
      const aliceSample = sampleUsers.find((u) => u.email === 'alice@example.com')!;
      const joinedResult = yield* userAdapter.findOne(
        { email: aliceSample.email },
        {
          joins: [{ table: officesTable, on: { officeId: 'id' } }],
        },
      );
      expectTypeOf(joinedResult).toEqualTypeOf<{ users: User; offices: Office } | null>;
      expect(joinedResult).not.toBeNull();
      expect(joinedResult!.users.email).toBe(aliceSample.email);
      expect(joinedResult!.offices.name).toBe(sampleOffices.find((o) => o.name === 'HQ')!.name);
    }),
  );
});

describe('Adapter insert()', () => {
  it.effect('should insert a single record and return it (with all fields by default)', () =>
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

  it.effect('should apply default values for omitted fields', () =>
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

  it.effect('should insert multiple records and return them', () =>
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

  it.effect('should return selected fields if select option is provided', () =>
    Effect.gen(function* () {
      const newUser: Omit<InsertUser, 'id'> = { name: 'Wendy', email: 'wendy@example.com', age: 40 };
      const insertedUsers = yield* userAdapter.insert(newUser, { select: { name: 1, email: 1 } });
      expectTypeOf(insertedUsers).toEqualTypeOf<Array<{ id: number; name: string; email: string | null }>>();
      expect(insertedUsers[0]).toEqual({ id: expect.any(Number), name: 'Wendy', email: 'wendy@example.com' });
    }),
  );

  it.effect('inserting empty array should return empty array and not throw', () =>
    Effect.gen(function* () {
      const users = yield* userAdapter.insert([]);
      expectTypeOf(users).toEqualTypeOf<User[]>();
      expect(users).toEqual([]);
    }),
  );

  it.effect('should return Err if NOT NULL constraint is violated', () =>
    Effect.gen(function* () {
      const newUser = { email: 'nonnull@example.com' } as Omit<InsertUser, 'id' | 'name'>;
      const exit = yield* Effect.exit(userAdapter.insert(newUser as Omit<InsertUser, 'id'>));
      expect(Exit.isFailure(exit)).toBe(true);
      // @ts-expect-error access internal effect
      expect(exit.cause.error.message).toMatch(/NOT NULL constraint failed: users.name/i);
    }),
  );

  it.effect('should return Err if UNIQUE constraint is violated (without conflict handling)', () =>
    Effect.gen(function* () {
      const existingUserEmail = sampleUsers[0].email!;
      const newUser: Omit<InsertUser, 'id'> = { name: 'Conflict User', email: existingUserEmail };
      const exit = yield* Effect.exit(userAdapter.insert(newUser));
      expect(Exit.isFailure(exit)).toBe(true);
      // @ts-expect-error access internal effect
      expect(exit.cause.error.message).toMatch(/UNIQUE constraint failed: users.email/i);
    }),
  );

  it.effect('should return Err if FOREIGN KEY constraint is violated', () =>
    Effect.gen(function* () {
      const newUser: Omit<InsertUser, 'id'> = { name: 'FK User', email: 'fk@example.com', officeId: 9999 };
      const exit = yield* Effect.exit(userAdapter.insert(newUser));
      expect(Exit.isFailure(exit)).toBe(true);
      // @ts-expect-error access internal effect
      expect(exit.cause.error.message).toMatch(/FOREIGN KEY constraint failed/i);
    }),
  );

  describe('conflict resolution (SQLite ON CONFLICT behavior)', () => {
    beforeEach(() => {
      Effect.runSync(
        Effect.provideService(
          Effect.gen(function* () {
            const alice = yield* userAdapter.findOne({ email: 'alice@example.com' });

            if (alice && alice.bio !== null) {
              yield* userAdapter.update({ ...alice, bio: null });
            }
          }),
          SqliteTag,
          db,
        ),
      );
    });

    it.effect('onConflictDoNothing (ignore): should not insert or update if email conflicts, returns empty for conflicted row', () =>
      Effect.gen(function* () {
        const originalAlice = yield* userAdapter.findOne({ email: 'alice@example.com' });
        expect(originalAlice).not.toBeNull();

        const conflictingUser: Omit<InsertUser, 'id'> = { name: 'New Alice', email: 'alice@example.com', age: 31 };

        const users = yield* userAdapter.insert(conflictingUser, {
          conflict: { target: ['email'], resolution: 'ignore' },
        });
        expectTypeOf(users).toEqualTypeOf<User[]>();
        expect(users).toEqual([]);

        const found = yield* userAdapter.findOne({ email: 'alice@example.com' });
        expectTypeOf(found).toEqualTypeOf<User | null>();
        expect(found).not.toBeNull();
        expect(found!.name).toBe(originalAlice!.name);
        expect(found!.age).toBe(originalAlice!.age);
      }),
    );

    it.effect('onConflictDoUpdate (update with explicit set): should update specified fields if email conflicts', () =>
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

        const originalAlice = yield* userAdapter.findOne({ email: aliceEmail });
        expectTypeOf(originalAlice).toEqualTypeOf<User | null>();
        expect(originalAlice).not.toBeNull();

        expect(originalAlice!.role).not.toBe('attemptedRole');

        const found = yield* userAdapter.findOne({ email: aliceEmail });
        expect(found).not.toBeNull();

        expect(found!.name).toBe('Updated Alice by Conflict');
        expect(found!.age).toBe(32);
      }),
    );

    it.effect('onConflictDoUpdate (update with explicit set using SQL): should update using SQL expression', () =>
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
        expectTypeOf(foundPair).toEqualTypeOf<UniquePair | null>();
        expect(foundPair?.valC).toBe('Initial C updated by SQL');
      }),
    );

    it.effect(
      'onConflictDoUpdate (update with implicit set from new values - using excluded): should update with new record values if email conflicts',
      () =>
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
          expectTypeOf(found).toEqualTypeOf<User | null>();
          expect(found).not.toBeNull();

          expect(found!.name).toBe('Implicit Update Alice');
          expect(found!.age).toBe(33);
          expect(found!.role).toBe('superadmin');
        }),
    );

    it.effect('onConflictDoUpdate (merge behavior): should update existing NULL fields with new values, keep existing non-NULL fields', () =>
      Effect.gen(function* () {
        const aliceOriginal = (yield* userAdapter.findOne({ email: 'alice@example.com' }))!;

        yield* userAdapter.update({ ...aliceOriginal, bio: null, age: 30 });
        const aliceAfterBioNull = (yield* userAdapter.findOne({ email: 'alice@example.com' }))!;
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

        const found = (yield* userAdapter.findOne({ email: 'alice@example.com' }))!;

        expect(found.name).toBe(aliceAfterBioNull.name);
        expect(found.bio).toBe('Merged Bio From New Value');
        expect(found.role).toBe(aliceAfterBioNull.role);
        expect(found.age).toBe(aliceAfterBioNull.age);
      }),
    );

    it.effect('onConflict with composite unique key target', () =>
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
        expectTypeOf(found).toEqualTypeOf<UniquePair | null>();
        expect(found?.valC).toBe('explicitlyUpdatedC');
      }),
    );
  });

  describe('Conflict Resolution - Advanced', () => {
    it.effect('onConflictDoUpdate (implicit from new values) should update all non-PK, non-conflict-target fields provided in new data', () =>
      Effect.gen(function* () {
        const bobEmail = 'bob@example.com';
        const originalBob = (yield* userAdapter.findOne({ email: bobEmail }))!;

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
        expect(foundBob).toEqual(updatedBob);
      }),
    );

    it.effect('onConflictDoNothing with multiple conflicting records in a batch insert, some non-conflicting', () =>
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

        const alice = (yield* userAdapter.findOne({ email: 'alice@example.com' }))!;
        const bob = (yield* userAdapter.findOne({ email: 'bob@example.com' }))!;
        expect(alice.age).not.toBe(100);
        expect(bob.age).not.toBe(101);
      }),
    );

    it.effect('onConflictDoUpdate with multiple records in batch: some conflict (update), some new (insert)', () =>
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
  });
});

describe('Adapter update()', () => {
  it.effect('should update an existing user and return the updated record', () =>
    Effect.gen(function* () {
      const alice = (yield* userAdapter.findOne({ email: 'alice@example.com' }))!;

      const updatedData: User = { ...alice, name: 'Alice Smith', age: 31 };

      const updatedUsers = yield* userAdapter.update(updatedData);
      expectTypeOf(updatedUsers).toEqualTypeOf<User[]>();
      expect(updatedUsers).toHaveLength(1);
      expect(updatedUsers[0].name).toBe('Alice Smith');
      expect(updatedUsers[0].age).toBe(31);
      expect(updatedUsers[0].id).toBe(alice.id);

      const found = yield* userAdapter.findOne({ id: alice.id });
      expectTypeOf(found).toEqualTypeOf<User | null>();
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice Smith');
    }),
  );

  it.effect('should allow updating a field to null', () =>
    Effect.gen(function* () {
      const bob = (yield* userAdapter.findOne({ email: 'bob@example.com' }))!;
      expect(bob.bio).not.toBeNull();

      const updatedData: User = { ...bob, bio: null };
      const users = yield* userAdapter.update(updatedData);
      expectTypeOf(users).toEqualTypeOf<User[]>();
      expect(users[0].bio).toBeNull();

      const found = yield* userAdapter.findOne({ id: bob.id });
      expectTypeOf(found).toEqualTypeOf<User | null>();
      expect(found!.bio).toBeNull();
    }),
  );

  it.effect('should return selected fields if select option is provided', () =>
    Effect.gen(function* () {
      const bob = (yield* userAdapter.findOne({ email: 'bob@example.com' }))!;

      const updatedData: User = { ...bob, role: 'lead_user' };

      const updatedUsers = yield* userAdapter.update(updatedData, { select: { id: 1, role: 1 } });
      expectTypeOf(updatedUsers).toEqualTypeOf<Array<{ id: number; role: string | null }>>();
      expect(updatedUsers[0]).toEqual({ id: bob.id, role: 'lead_user' });
    }),
  );

  it.effect('should return Err if record.id is null/undefined', () =>
    Effect.gen(function* () {
      const invalidUser = { name: 'No ID User', email: 'noid@example.com' } as unknown as User;
      const exit = yield* Effect.exit(userAdapter.update(invalidUser));
      expect(Exit.isFailure(exit)).toBe(true);
      // @ts-expect-error access internal effect
      expect(exit.cause.error.message).toMatch(/Missing required "id" for update operation/i);
    }),
  );

  it.effect('should return an empty array if id does not exist (updates 0 rows)', () =>
    Effect.gen(function* () {
      const nonExistentUser: User = { id: 9999, name: 'Ghost', email: 'ghost@example.com', age: null, role: null, officeId: null, bio: null };
      const users = yield* userAdapter.update(nonExistentUser);
      expectTypeOf(users).toEqualTypeOf<User[]>();
      expect(users).toEqual([]);
    }),
  );

  it.effect('should return Err if update violates UNIQUE constraint', () =>
    Effect.gen(function* () {
      const alice = (yield* userAdapter.findOne({ email: 'alice@example.com' }))!;
      const bob = (yield* userAdapter.findOne({ email: 'bob@example.com' }))!;

      const updatedBob: User = { ...bob, email: alice.email };
      const exit = yield* Effect.exit(userAdapter.update(updatedBob));
      expect(Exit.isFailure(exit)).toBe(true);
      // @ts-expect-error access internal effect
      expect(exit.cause.error.message).toMatch(/UNIQUE constraint failed: users.email/i);
    }),
  );

  it.effect('should return Err if update violates FOREIGN KEY constraint', () =>
    Effect.gen(function* () {
      const charlie = (yield* userAdapter.findOne({ email: 'charlie@example.com' }))!;
      const updatedCharlie: User = { ...charlie, officeId: 9999 };
      const exit = yield* Effect.exit(userAdapter.update(updatedCharlie));
      expect(Exit.isFailure(exit)).toBe(true);
      // @ts-expect-error access internal effect
      expect(exit.cause.error.message).toMatch(/FOREIGN KEY constraint failed/i);
    }),
  );

  it.effect('attempting to change PK `id` via update payload should be ignored', () =>
    Effect.gen(function* () {
      const charlie = (yield* userAdapter.findOne({ email: 'charlie@example.com' }))!;
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
});

describe('Adapter delete()', () => {
  it.effect('should delete an existing user and return the deleted record', () =>
    Effect.gen(function* () {
      const charlie = (yield* userAdapter.findOne({ email: 'charlie@example.com' }))!;

      const deletedUsers = yield* userAdapter.delete(charlie);
      expectTypeOf(deletedUsers).toEqualTypeOf<User[]>();
      expect(deletedUsers).toHaveLength(1);
      expect(deletedUsers[0].id).toBe(charlie.id);
      expect(deletedUsers[0].name).toBe(charlie.name);

      const found = yield* userAdapter.findOne({ id: charlie.id });
      expect(found).toBeNull();

      const count = yield* userAdapter.count();
      expect(count).toBe(sampleUsers.length - 1);
    }),
  );

  it.effect('should return selected fields if select option is provided', () =>
    Effect.gen(function* () {
      const david = (yield* userAdapter.findOne({ email: 'david@example.com' }))!;

      const deletedUsers = yield* userAdapter.delete(david, { select: { name: 1 } });
      expectTypeOf(deletedUsers).toEqualTypeOf<Array<{ id: number; name: string }>>();

      expect(deletedUsers[0]).toEqual({ id: david.id, name: 'David' });
      expect(Object.keys(deletedUsers[0]).sort()).toEqual(['id', 'name'].sort());
    }),
  );

  it.effect('should return Err if record.id is null/undefined', () =>
    Effect.gen(function* () {
      const invalidUser = { name: 'No ID User To Delete' } as unknown as User;
      const exit = yield* Effect.exit(userAdapter.delete(invalidUser));
      expect(Exit.isFailure(exit)).toBe(true);
      // @ts-expect-error access internal effect
      expect(exit.cause.error.message).toMatch(/Missing required "id" for delete operation/i);
    }),
  );

  it.effect('should return an empty array if id does not exist (deletes 0 rows)', () =>
    Effect.gen(function* () {
      const nonExistentUser: User = { id: 8888, name: 'Phantom', email: 'phantom@example.com', age: null, role: null, officeId: null, bio: null };
      const users = yield* userAdapter.delete(nonExistentUser);
      expectTypeOf(users).toEqualTypeOf<User[]>();
      expect(users).toEqual([]);
    }),
  );
});

describe('Adapter findOneAndUpdate()', () => {
  it.effect('should find and update a user if filter matches', () =>
    Effect.gen(function* () {
      const eveOriginal = (yield* userAdapter.findOne({ email: 'eve@example.com' }))!;

      const updatePayload = { age: 31, role: 'senior_manager' };

      const updatedUser = yield* userAdapter.findOneAndUpdate({ email: 'eve@example.com' }, updatePayload);

      expectTypeOf(updatedUser).toEqualTypeOf<User | null>();
      expect(updatedUser).toBeDefined();
      expect(updatedUser).not.toBeNull();
      expect(updatedUser!.id).toBe(eveOriginal.id);
      expect(updatedUser!.age).toBe(updatePayload.age);
      expect(updatedUser!.role).toBe(updatePayload.role);

      const found = yield* userAdapter.findOne({ id: eveOriginal.id });
      expect(found).not.toBeNull();
      expect(found!.age).toBe(updatePayload.age);
      expect(found!.role).toBe(updatePayload.role);
    }),
  );

  it.effect('should insert a new user if filter does not match and upsert is true', () =>
    Effect.gen(function* () {
      const newUserEmail = 'newupsert@example.com';

      const filterForUpsert: Partial<User> = { email: newUserEmail };
      const upsertPayload: Partial<Omit<InsertUser, 'id'>> = { name: 'New Upserted', age: 25, role: 'intern' };

      const upsertedUser = yield* userAdapter.findOneAndUpdate(filterForUpsert, upsertPayload, { upsert: true });

      expectTypeOf(upsertedUser).toEqualTypeOf<User | null>();
      expect(upsertedUser).toBeDefined();
      expect(upsertedUser).not.toBeNull();

      expect(upsertedUser!.email).toBe(newUserEmail);
      expect(upsertedUser!.name).toBe(upsertPayload.name);
      expect(upsertedUser!.age).toBe(upsertPayload.age);
      expect(upsertedUser!.role).toBe(upsertPayload.role);
      expect(upsertedUser!.id).toBeTypeOf('number');

      const found = yield* userAdapter.findOne({ email: newUserEmail });
      expect(found).toBeDefined();
      expect(found).not.toBeNull();
      expect(found!.name).toBe(upsertPayload.name);
    }),
  );

  it.effect('should insert a new user using filter data combined with update data (update data overwrites filter for same keys)', () =>
    Effect.gen(function* () {
      const newUserEmail = 'newupsertfilter@example.com';
      const filterData: Partial<User> = { email: newUserEmail, role: 'default_role_from_filter', name: 'Name From Filter (will be overwritten)' };
      const updateData: Partial<Omit<InsertUser, 'id'>> = { name: 'New Upserted Filter', age: 26 };

      const upsertedUser = yield* userAdapter.findOneAndUpdate(filterData, updateData, { upsert: true });

      expectTypeOf(upsertedUser).toEqualTypeOf<User | null>();
      expect(upsertedUser).toBeDefined();
      expect(upsertedUser).not.toBeNull();
      expect(upsertedUser!.email).toBe(newUserEmail);
      expect(upsertedUser!.name).toBe(updateData.name);
      expect(upsertedUser!.age).toBe(updateData.age);
      expect(upsertedUser!.role).toBe(filterData.role);
    }),
  );

  it.effect('should return null if filter does not match and upsert is false (or not specified)', () =>
    Effect.gen(function* () {
      const user = yield* userAdapter.findOneAndUpdate({ email: 'nosuchuser@example.com' }, { name: 'No Update' });
      expect(user).toBeNull();
    }),
  );

  it.effect('should apply select option on returned record (update)', () =>
    Effect.gen(function* () {
      const malloryOriginal = (yield* userAdapter.findOne({ email: 'mallory@example.com' }))!;

      const updatePayload = { bio: 'Updated Bio via FindOneAndUpdate' };

      const selectedUser = yield* userAdapter.findOneAndUpdate({ email: 'mallory@example.com' }, updatePayload, { select: { id: 1, bio: 1 } });
      expectTypeOf(selectedUser).toEqualTypeOf<{ id: number; bio: string | null } | null>();
      expect(selectedUser).not.toBeNull();
      expect(selectedUser).toEqual({ id: malloryOriginal.id, bio: updatePayload.bio });
    }),
  );

  it.effect('should apply select option on returned record (insert with upsert:true)', () =>
    Effect.gen(function* () {
      const newUserEmail = 'selectupsert@example.com';
      const filterForUpsert: Partial<User> = { email: newUserEmail };
      const unwrappedResult = yield* userAdapter.findOneAndUpdate(
        filterForUpsert,
        { name: 'Select Upsert', age: 22 },
        { upsert: true, select: { name: 1, email: 1 } },
      );
      expectTypeOf(unwrappedResult).toEqualTypeOf<{ id: number; name: string; email: string | null } | null>();
      expect(unwrappedResult).not.toBeNull();
      expect(unwrappedResult).toEqual(expect.objectContaining({ id: expect.any(Number), name: 'Select Upsert', email: newUserEmail }));
    }),
  );

  it.effect('should return the found record if filter matches but data for update is empty and record is unchanged', () =>
    Effect.gen(function* () {
      const alice = (yield* userAdapter.findOne({ email: 'alice@example.com' }))!;

      const returnedUser = yield* userAdapter.findOneAndUpdate({ email: 'alice@example.com' }, {});

      expectTypeOf(returnedUser).toEqualTypeOf<User | null>();
      expect(returnedUser).not.toBeNull();
      expect(returnedUser!.id).toBe(alice.id);
      expect(returnedUser!.name).toBe(alice.name);

      const aliceAfter = yield* userAdapter.findOne({ id: alice.id });
      expect(aliceAfter).toEqual({ ...alice });
    }),
  );

  it.effect('should upsert correctly on an empty table with upsert: true', () =>
    Effect.gen(function* () {
      client.exec('DELETE FROM users;');
      const newUserEmail = 'emptyupsert@example.com';
      const filterForUpsert: Partial<User> = { email: newUserEmail };
      const payload = { name: 'Empty Upsert', age: 20 };
      const user = yield* userAdapter.findOneAndUpdate(filterForUpsert, payload, { upsert: true });
      expectTypeOf(user).toEqualTypeOf<User | null>();
      expect(user).not.toBeNull();
      expect(user!.email).toBe(newUserEmail);
      expect(user!.name).toBe(payload.name);
      expect(yield* userAdapter.count()).toBe(1);
    }),
  );

  it.effect('should fail upsert if combined data for insert violates NOT NULL constraint', () =>
    Effect.gen(function* () {
      const newUserEmail = 'failupsert@example.com';

      const filterForUpsert: Partial<User> = { email: newUserEmail };
      const payload = { age: 22 };
      const exit = yield* Effect.exit(userAdapter.findOneAndUpdate(filterForUpsert, payload, { upsert: true }));
      expect(Exit.isFailure(exit)).toBe(true);
      // @ts-expect-error access internal effect
      expect(exit.cause.error.message).toMatch(/NOT NULL constraint failed: users.name/i);
    }),
  );

  it.effect('should update only the first matching record if filter matches multiple (respecting implicit/explicit order)', () =>
    Effect.gen(function* () {
      const usersAge30 = sampleUsers.filter((u) => u.age === 30);
      expect(usersAge30.length).toBeGreaterThan(1);

      const initialAge30Users = yield* userAdapter.find({ age: 30 }, { order: { id: 'asc' } });
      const firstUserId = initialAge30Users[0].id;

      const updatedUser = yield* userAdapter.findOneAndUpdate(
        { age: 30 },
        { bio: 'Updated by findOneAndUpdate for age 30' },
        { order: { id: 'asc' } },
      );
      expectTypeOf(updatedUser).toEqualTypeOf<User | null>();
      expect(updatedUser).not.toBeNull();
      expect(updatedUser!.id).toBe(firstUserId);
      expect(updatedUser!.bio).toBe('Updated by findOneAndUpdate for age 30');

      const otherAge30Users = yield* userAdapter.find({ age: 30, id: { $ne: firstUserId } });
      otherAge30Users.forEach((user) => {
        const originalUser = usersAge30.find((u) => u.email === user.email);
        expect(user.bio).toBe(originalUser?.bio);
      });
    }),
  );

  describe('Upsert Behavior with Conflicts - Additional', () => {
    it.effect('upsert: true, new record (from filter + data) insert conflicts with an existing different record unique constraint', () =>
      Effect.gen(function* () {
        const bobEmail = sampleUsers.find((u) => u.name === 'Bob')!.email!;
        const newNonExistentEmail = 'nonexistentupsertconflict@example.com';

        const exit = yield* Effect.exit(
          userAdapter.findOneAndUpdate({ email: newNonExistentEmail }, { name: 'Conflicting Upsert', email: bobEmail, age: 40 }, { upsert: true }),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error access internal effect
        expect(exit.cause.error.message).toMatch(/UNIQUE constraint failed: users.email/i);
        expect(yield* userAdapter.findOne({ email: newNonExistentEmail })).toBeNull();
        const bobUser = yield* userAdapter.findOne({ email: bobEmail });
        expect(bobUser!.name).toBe('Bob');
      }),
    );

    it.effect('upsert: true, filter matches, but update causes unique constraint violation with another record', () =>
      Effect.gen(function* () {
        const aliceEmail = sampleUsers.find((u) => u.name === 'Alice')!.email!;
        const bobEmail = sampleUsers.find((u) => u.name === 'Bob')!.email!;

        const exit = yield* Effect.exit(userAdapter.findOneAndUpdate({ email: aliceEmail }, { email: bobEmail }, { upsert: true }));

        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error access internal effect
        expect(exit.cause.error.message).toMatch(/UNIQUE constraint failed: users.email/i);
        const aliceUser = yield* userAdapter.findOne({ name: 'Alice' });
        expect(aliceUser!.email).toBe(aliceEmail);
      }),
    );

    it.effect('upsert: true, filter includes null value, no match, should insert with null value from filter merged with payload', () =>
      Effect.gen(function* () {
        const filterWithNull: Partial<User> = { email: 'upsertnullbio@example.com', bio: null };
        const payload = { name: 'Upsert Null Bio User', age: 33 };

        const user = yield* userAdapter.findOneAndUpdate(filterWithNull, payload, { upsert: true });
        expectTypeOf(user).toEqualTypeOf<User | null>();

        expect(user).not.toBeNull();
        expect(user!.email).toBe(filterWithNull.email);
        expect(user!.name).toBe(payload.name);
        expect(user!.bio).toBeNull();
        expect(user!.age).toBe(payload.age);

        const dbUser = yield* userAdapter.findOne({ email: filterWithNull.email });
        expect(dbUser!.bio).toBeNull();
      }),
    );

    it.effect('upsert: true should return error when using complex filter operators', () =>
      Effect.gen(function* () {
        const complexFilter = { age: { $gt: 200 } };
        const payload: Partial<Omit<InsertUser, 'id'>> = {
          name: 'Should Fail',
          email: 'fail@example.com',
          age: 201,
        };

        const exit = yield* Effect.exit(userAdapter.findOneAndUpdate(complexFilter, payload, { upsert: true }));
        expect(Exit.isFailure(exit)).toBe(true);
        // @ts-expect-error access internal effect
        expect(exit.cause.error.message).toMatch(/Cannot use complex filter when upserting/i);
      }),
    );
  });
});

describe('Adapter findOneAndDelete()', () => {
  it.effect('should find and delete a user if filter matches, returning the deleted record', () =>
    Effect.gen(function* () {
      const trent = (yield* userAdapter.findOne({ email: 'trent@example.com' }))!;

      const initialCount = yield* userAdapter.count();

      const deletedUser = yield* userAdapter.findOneAndDelete({ email: 'trent@example.com' });
      expectTypeOf(deletedUser).toEqualTypeOf<User | null>();
      expect(deletedUser).toBeDefined();
      expect(deletedUser).not.toBeNull();
      expect(deletedUser!.id).toBe(trent.id);
      expect(deletedUser!.name).toBe(trent.name);

      expect(yield* userAdapter.findOne({ id: trent.id })).toBeNull();
      const currentCount = yield* userAdapter.count();
      expect(currentCount).toBe(initialCount - 1);
    }),
  );

  it.effect('should return null if no user matches filter', () =>
    Effect.gen(function* () {
      const user = yield* userAdapter.findOneAndDelete({ email: 'ghost@example.com' });
      expectTypeOf(user).toEqualTypeOf<User | null>();
      expect(user).toBeNull();
    }),
  );

  it.effect('should return null when trying to delete on an empty table', () =>
    Effect.gen(function* () {
      client.exec('DELETE FROM users;');
      const user = yield* userAdapter.findOneAndDelete({ name: 'AnyName' });
      expectTypeOf(user).toEqualTypeOf<User | null>();
      expect(user).toBeNull();
    }),
  );

  it.effect('should apply select option on returned (deleted) record', () =>
    Effect.gen(function* () {
      const ursula = (yield* userAdapter.findOne({ email: 'ursula@example.com' }))!;

      const deletedUser = yield* userAdapter.findOneAndDelete({ email: 'ursula@example.com' }, { select: { id: 1, name: 1, email: 1 } });
      expectTypeOf(deletedUser).toEqualTypeOf<{ id: number; name: string; email: string | null } | null>();
      expect(deletedUser).not.toBeNull();
      expect(deletedUser).toEqual({ id: ursula.id, name: 'Ursula User', email: 'ursula@example.com' });
    }),
  );

  it.effect('should delete only the first matching record if filter matches multiple (respecting order)', () =>
    Effect.gen(function* () {
      const usersAge30 = sampleUsers.filter((u) => u.age === 30);
      expect(usersAge30.length).toBeGreaterThan(1);

      const initialAge30Users = yield* userAdapter.find({ age: 30 }, { order: { id: 'asc' } });
      const firstUserId = initialAge30Users[0].id;
      const firstUserName = initialAge30Users[0].name;

      const deletedUser = yield* userAdapter.findOneAndDelete({ age: 30 }, { order: { id: 'asc' } });
      expectTypeOf(deletedUser).toEqualTypeOf<User | null>();
      expect(deletedUser).not.toBeNull();
      expect(deletedUser!.id).toBe(firstUserId);
      expect(deletedUser!.name).toBe(firstUserName);

      expect(yield* userAdapter.findOne({ id: firstUserId })).toBeNull();
      expect(yield* userAdapter.count({ age: 30 })).toBe(initialAge30Users.length - 1);
    }),
  );
});

describe('Foreign Key Cascades (SQLite ON DELETE CASCADE Behavior Verification)', () => {
  it.effect('deleting a user should cascade delete their posts', () =>
    Effect.gen(function* () {
      const alice = (yield* userAdapter.findOne({ email: 'alice@example.com' }))!;

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

  it.effect('deleting an office should cascade delete users in that office, and their posts indirectly', () =>
    Effect.gen(function* () {
      const hqOffice = (yield* officeAdapter.findOne({ name: 'HQ' }))!;

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
