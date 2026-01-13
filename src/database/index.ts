import { join, resolve } from 'node:path';
import { Context, Layer } from 'effect';

import { Adapter, createConfig } from '../structures/database';
import { accountTable, userTable } from './schema';

const isDrizzleKit = process.argv.toString().includes('drizzle-kit');
const projectDir = resolve(__dirname, '..', '..');

const out = './migrations';
const schema = './src/database/schema.ts';

export const sqliteConfig = createConfig({
  out: isDrizzleKit ? out : join(projectDir, out),
  schema: isDrizzleKit ? schema : join(projectDir, schema),
});

export class UserDatabaseTag extends Context.Tag('@database/User')<UserDatabaseTag, Adapter<typeof userTable>>() {}

export const UserDatabaseLayer = Layer.succeed(UserDatabaseTag, Adapter(userTable));

export class AccountDatabaseTag extends Context.Tag('@database/Account')<AccountDatabaseTag, Adapter<typeof accountTable>>() {}

export const AccountDatabaseLayer = Layer.succeed(AccountDatabaseTag, Adapter(accountTable));
