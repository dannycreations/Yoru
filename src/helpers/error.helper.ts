import { isErrorLike } from '@vegapunk/utilities/result';
import { HTTPError } from 'clashofclans.js';
import { Effect } from 'effect';

import { ClashError } from '../services/ClashService';

// Error conversion logic translates various error types into user-friendly messages to ensure consistent feedback across all interaction points.
export const formatErrorMessage = (error: unknown): string => {
  const cause = error instanceof ClashError ? error.cause : error;

  if (cause instanceof HTTPError) {
    // Missing player tags trigger specific error messages to address a common user mistake.
    if (cause.reason === 'notFound' && cause.path.includes('/players/')) {
      return 'Error, Player tag not found!';
    }
    return cause.message;
  }

  if (error instanceof ClashError) {
    return error.message;
  }

  if (isErrorLike(error) && 'message' in error) {
    return error.message;
  }

  return 'Unhandled Rejection, please contact owner!';
};

// A logging utility formats errors for command replies to reduce boilerplate in command handlers.
export const replyWithError = (message: { content: string; reply: (content: string) => Promise<unknown> }, error: unknown) =>
  Effect.gen(function* () {
    const errorMessage = formatErrorMessage(error);

    // Logging of full error details is restricted to truly unexpected failures to maintain log clarity.
    if (errorMessage === 'Unhandled Rejection, please contact owner!') {
      yield* Effect.logError('Unexpected error encountered:', error);
    }

    yield* Effect.tryPromise(() => message.reply(`> ${message.content}\n${errorMessage}`));
  });
