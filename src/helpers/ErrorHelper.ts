import { isErrorLike } from '@vegapunk/utilities/result';
import { HttpError } from 'clashofclans.js';
import { Effect } from 'effect';

import { isClashError } from '../services/ClashService.js';

import type { Message } from 'discord.js';

const getErrorMessage = (error: unknown): string | undefined => {
  const cause = isClashError(error) ? error.cause : error;

  if (cause instanceof HttpError) {
    if (cause.reason === 'notFound' && cause.path.includes('/players/')) {
      return 'Error, Player tag not found!';
    }

    return cause.message;
  }

  if (isClashError(error)) {
    return error.message;
  }

  if (isErrorLike<{ readonly message: string }>(error)) {
    return error.message;
  }

  return undefined;
};

export const replyWithError = (message: Message<true>, error: unknown): Effect.Effect<void> =>
  Effect.gen(function* () {
    const errorMessage = getErrorMessage(error);

    if (errorMessage === undefined) {
      yield* Effect.logError('Unexpected error encountered', error);
    }

    const reply = `> ${message.content}\n${errorMessage ?? 'Unhandled Rejection, please contact owner!'}`;
    yield* Effect.tryPromise(() => message.reply(reply)).pipe(Effect.ignore);
  }).pipe(Effect.asVoid);
