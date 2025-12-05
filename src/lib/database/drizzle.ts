import { join, resolve } from 'node:path';
import { Adapter, config, start } from '@vegapunk/drizzle-orm/bsqlite';

import { accountTable, userTable } from './schema';

const isDrizzleKit = process.argv.toString().includes('drizzle-kit');
const projectDir = resolve(__dirname, '..', '..', '..');

const out = './src/lib/database/migrations';
const schema = './src/lib/database/schema.ts';

export const drizzleConfig = config({
  out: isDrizzleKit ? out : join(projectDir, out),
  schema: isDrizzleKit ? schema : join(projectDir, schema),
});
export const db = start(drizzleConfig);

export const DBUser = new Adapter(db, userTable);
export const DBAccount = new Adapter(db, accountTable);
