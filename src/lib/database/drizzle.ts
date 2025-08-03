import { Adapter, config, start } from '@vegapunk/drizzle-orm/bsqlite';

import { accountTable, userTable } from './schema';

export const drizzleConfig = config();
export const db = start(drizzleConfig);

export const DBUser = new Adapter(db, userTable);
export const DBAccount = new Adapter(db, accountTable);
