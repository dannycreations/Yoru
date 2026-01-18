import { isErrorLike } from '@vegapunk/utilities/result';
import { HTTPError } from 'clashofclans.js';
import { Effect } from 'effect';

import { ClashError } from '../services/ClashService';

import type { Message } from 'discord.js';

export const replyWithError = (message: Message<true>, error: unknown): Effect.Effect<void> =>
  Effect.gen(function* () {
    const cause = error instanceof ClashError ? error.cause : error;

    const errorMessage = yield* Effect.sync(() => {
      if (cause instanceof HTTPError) {
        return cause.reason === 'notFound' && cause.path.includes('/players/') ? 'Error, Player tag not found!' : cause.message;
      }
      if (error instanceof ClashError) {
        return error.message;
      }
      if (isErrorLike(error)) {
        return error.message;
      }
      return null;
    });

    const reply =
      errorMessage === null ? `> ${message.content}\nUnhandled Rejection, please contact owner!` : `> ${message.content}\n${errorMessage}`;

    if (errorMessage === null) {
      yield* Effect.logError('Unexpected error encountered', error);
    }

    yield* Effect.tryPromise(() => message.reply(reply)).pipe(Effect.ignore);
  }).pipe(Effect.asVoid);
