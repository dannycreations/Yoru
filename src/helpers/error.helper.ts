import { isErrorLike } from '@vegapunk/utilities/result';
import { HTTPError } from 'clashofclans.js';
import { Effect } from 'effect';

import { ClashError } from '../services/ClashService';

import type { Message } from 'discord.js';

export const replyWithError = (message: Message<true>, error: unknown) =>
  Effect.gen(function* () {
    const cause = error instanceof ClashError ? error.cause : error;

    let errorMessage = 'Unhandled Rejection, please contact owner!';

    if (cause instanceof HTTPError) {
      errorMessage = cause.reason === 'notFound' && cause.path.includes('/players/') ? 'Error, Player tag not found!' : cause.message;
    } else if (error instanceof ClashError) {
      errorMessage = error.message;
    } else if (isErrorLike(error) && 'message' in error) {
      errorMessage = error.message;
    } else {
      yield* Effect.logError('Unexpected error encountered', error);
    }

    yield* Effect.tryPromise(() => message.reply(`> ${message.content}\n${errorMessage}`));
  }).pipe(Effect.asVoid);
