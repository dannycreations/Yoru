import { isErrorLike } from '@vegapunk/utilities/result';
import { HTTPError } from 'clashofclans.js';
import { Effect, Option } from 'effect';

import { ClashError } from '../services/ClashService';

import type { Message } from 'discord.js';

const getErrorMessage = (error: unknown): Option.Option<string> => {
  const cause = error instanceof ClashError ? error.cause : error;

  if (cause instanceof HTTPError) {
    if (cause.reason === 'notFound' && cause.path.includes('/players/')) {
      return Option.some('Error, Player tag not found!');
    }

    return Option.some(cause.message);
  }

  if (error instanceof ClashError) {
    return Option.some(error.message);
  }

  if (isErrorLike<{ readonly message: string }>(error)) {
    return Option.some(error.message);
  }

  return Option.none();
};

export const replyWithError = (message: Message<true>, error: unknown): Effect.Effect<void> =>
  Effect.gen(function* () {
    const errorMessage = getErrorMessage(error);

    const reply = Option.match(errorMessage, {
      onNone: () => `> ${message.content}\nUnhandled Rejection, please contact owner!`,
      onSome: (msg) => `> ${message.content}\n${msg}`,
    });

    if (Option.isNone(errorMessage)) {
      yield* Effect.logError('Unexpected error encountered', error);
    }

    yield* Effect.tryPromise(() => message.reply(reply)).pipe(Effect.ignore);
  }).pipe(Effect.asVoid);
