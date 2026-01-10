import { join, resolve } from 'node:path';

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

export const UserAdapter = Adapter(userTable);
export const AccountAdapter = Adapter(accountTable);
