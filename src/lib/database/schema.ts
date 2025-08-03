import { integer, sqliteTable, text } from '@vegapunk/drizzle-orm/bsqlite';

export const userTable = sqliteTable('user', {
  id: integer().primaryKey({ autoIncrement: true }),
  ownerId: text('owner_id').unique().notNull(),
});

export const accountTable = sqliteTable('account', {
  id: integer().primaryKey({ autoIncrement: true }),
  tag: text().unique().notNull(),
  userId: integer('user_id')
    .references(() => userTable.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: integer('created_at').$default(() => Date.now()),
  isBanned: integer('is_banned', { mode: 'boolean' }),
  bannedAt: integer('banned_at'),
});

export type userTableType = typeof userTable.$inferSelect;
export type accountTableType = typeof accountTable.$inferSelect;
