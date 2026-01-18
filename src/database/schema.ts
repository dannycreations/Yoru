import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Data, Schema } from 'effect';

export const userTable = sqliteTable('user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: text('owner_id').unique().notNull(),
});

export const UserSchema = Schema.Struct({
  id: Schema.Number,
  ownerId: Schema.String,
});

export interface UserTable extends Schema.Schema.Type<typeof UserSchema> {}

export const user = (data: UserTable): UserTable => Data.struct(data);

export const accountTable = sqliteTable('account', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tag: text('tag').unique().notNull(),
  userId: integer('user_id')
    .references(() => userTable.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: integer('created_at').$default(() => Date.now()),
  bannedAt: integer('banned_at'),
});

export const AccountSchema = Schema.Struct({
  id: Schema.Number,
  tag: Schema.String,
  userId: Schema.Number,
  createdAt: Schema.NullOr(Schema.Number),
  bannedAt: Schema.NullOr(Schema.Number),
});

export interface AccountTable extends Schema.Schema.Type<typeof AccountSchema> {}

export const account = (data: AccountTable): AccountTable => Data.struct(data);
