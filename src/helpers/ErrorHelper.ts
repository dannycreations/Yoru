import { isErrorLike } from '@vegapunk/utilities/result';
import { HTTPError } from 'clashofclans.js';
import { Effect, Option } from 'effect';

import { ClashError } from '../services/ClashService';

import type { Message } from 'discord.js';

export const replyWithError = (message: Message<true>, error: unknown): Effect.Effect<void> =>
  Effect.gen(function* () {
    const cause = error instanceof ClashError ? error.cause : error;

    const errorMessage = Option.fromNullable(
      (() => {
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
      })(),
    );

    const reply = Option.match(errorMessage, {
      onNone: () => `> ${message.content}\nUnhandled Rejection, please contact owner!`,
      onSome: (msg) => `> ${message.content}\n${msg}`,
    });

    if (Option.isNone(errorMessage)) {
      yield* Effect.logError('Unexpected error encountered', error);
    }

    yield* Effect.tryPromise(() => message.reply(reply)).pipe(Effect.ignore);
  }).pipe(Effect.asVoid);
