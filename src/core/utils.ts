import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Effect } from 'effect';

export const ensureDir = (path: string) => Effect.tryPromise(() => mkdir(dirname(path), { recursive: true }));
