import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const userTable = sqliteTable('user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: text('owner_id').unique().notNull(),
});

export const accountTable = sqliteTable('account', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tag: text('tag').unique().notNull(),
  userId: integer('user_id')
    .references(() => userTable.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: integer('created_at').$default(() => Date.now()),
  bannedAt: integer('banned_at'),
});

export type UserTable = typeof userTable.$inferSelect;
export type AccountTable = typeof accountTable.$inferSelect;
