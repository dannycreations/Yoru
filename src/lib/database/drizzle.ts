import { join, resolve } from 'node:path';
import { Adapter, config, start } from '@vegapunk/drizzle-orm/bsqlite';

import { accountTable, userTable } from './schema';

const projectDir = resolve(__dirname, '..', '..', '..');

export const drizzleConfig = config({
  out: join(projectDir, 'src/lib/database/migrations'),
  schema: join(projectDir, 'src/lib/database/schema.ts'),
});
export const db = start(drizzleConfig);

export const DBUser = new Adapter(db, userTable);
export const DBAccount = new Adapter(db, accountTable);
