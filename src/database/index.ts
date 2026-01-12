import { join, resolve } from 'node:path';
import { Context, Layer } from 'effect';

import { Adapter, createConfig } from '../services/database';
import { accountTable, userTable } from './schema';

const isDrizzleKit = process.argv.toString().includes('drizzle-kit');
const projectDir = resolve(__dirname, '..', '..');

const out = './migrations';
const schema = './src/database/schema.ts';

export const sqliteConfig = createConfig({
  out: isDrizzleKit ? out : join(projectDir, out),
  schema: isDrizzleKit ? schema : join(projectDir, schema),
});

export const UserDatabaseTag = Context.GenericTag<Adapter<typeof userTable>>('@layer/UserDatabaseLayer');
export const UserDatabaseLayer = Layer.succeed(UserDatabaseTag, Adapter(userTable));

export const AccountDatabaseTag = Context.GenericTag<Adapter<typeof accountTable>>('@layer/AccountDatabaseLayer');
export const AccountDatabaseLayer = Layer.succeed(AccountDatabaseTag, Adapter(accountTable));
