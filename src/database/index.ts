import { Adapter } from '../services/database';
import { accountTable, userTable } from './schema';

export const UserAdapter = Adapter(userTable);
export const AccountAdapter = Adapter(accountTable);
