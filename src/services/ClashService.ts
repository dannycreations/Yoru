import { isErrorLike } from '@vegapunk/utilities/result';
import { PollingClient as ClashClient, HTTPError } from 'clashofclans.js';
import { Context, Data, Effect, Layer, Schedule } from 'effect';

import { ClientEvents } from '../core/constants';
import { ConfigStore, EnvTag } from '../core/schemas';
import { ERROR_CODES, ERROR_STATUS_CODES, HttpClient, waitForConnection } from './HttpService';

import type { RequestOptions } from 'clashofclans.js';

/**
 * Custom error class for Clash of Clans API related errors.
 */
export class ClashApiError extends Data.TaggedError('ClashApiError')<{
  readonly message: string;
  readonly status?: number;
  readonly reason?: string;
  readonly cause?: unknown;
}> {}

/**
 * Represents the Clash of Clans API service.
 */
export interface ClashService {
  readonly client: ClashClient;
}

/**
 * Context tag for the ClashService.
 */
export const ClashClientTag = Context.GenericTag<ClashService>('@services/ClashService');

/**
 * Implementation of the ClashService.
 * Handles authentication, automatic IP rotation (on 403), and request retries.
 */
const createClashService = Effect.gen(function* () {
  const http = yield* HttpClient;
  const configStore = yield* ConfigStore;
  const env = yield* EnvTag;

  const client = new ClashClient({
    keys: [],
    pollingInterval: 60_000,
  });

  /**
   * Performs login to the Clash of Clans API.
   */
  const login = () =>
    Effect.tryPromise({
      try: () =>
        client.rest.login({
          email: env.CLASH_EMAIL,
          password: env.CLASH_PASSWORD,
          keyName: 'Yoru',
          keyCount: 1,
        }),
      catch: (error) => new ClashApiError({ message: 'Failed to login to Clash API', cause: error }),
    });

  // Override internal library methods to provide custom behavior.
  client.rest.requestHandler['reValidateKeys'] = () => Promise.resolve();

  let ipFromError: string | undefined;
  let requestState = 0;

  const requestHandler = client.rest.requestHandler;

  const getIpOrig = requestHandler['getIp'].bind(requestHandler);
  requestHandler['getIp'] = (token: string) => {
    if (ipFromError) {
      const ip = ipFromError;
      ipFromError = undefined;
      return ip;
    }
    return getIpOrig(token);
  };

  const requestOrig = requestHandler.request.bind(requestHandler);

  /**
   * Custom request implementation with error handling and retry logic.
   */
  requestHandler.request = async <T>(path: string, options: RequestOptions = {}) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* Effect.tryPromise(() => requestOrig<T>(path, options)).pipe(
          Effect.tap(() => {
            requestState = 0;
          }),
          Effect.catchAll((error) => {
            if (requestState > 2) {
              requestState = 2;
              return Effect.fail(
                new ClashApiError({
                  message: 'API problem, please check back later!',
                  cause: error,
                }),
              );
            }

            // Handle network-level errors (e.g., DNS, timeouts) by waiting for connection recovery.
            if (isErrorLike(error) && ERROR_CODES.includes(error.code)) {
              requestState = 0;
              return waitForConnection().pipe(
                Effect.flatMap(() => Effect.fail(new ClashApiError({ message: 'Retrying after connection recovery', cause: error }))),
              );
            }

            if (error instanceof HTTPError) {
              // 503 is standard for Clash API maintenance.
              if (error.status === 503) {
                requestState = 0;
                return Effect.fail(
                  new ClashApiError({
                    message: 'Service is temporarily unavailable because of maintenance!',
                    status: 503,
                  }),
                );
              }

              // Handle "accessDenied.invalidIp" by clearing the current key and re-logging in to get a new one.
              if (error.status === 403 && error.reason === 'accessDenied.invalidIp') {
                requestHandler['keys'].shift();
                // Extract IP from error message to potentially use it in the next request if the library supports it.
                ipFromError = error.message.match(/(\d{1,3}\.){3}\d+/)![0];
                return login().pipe(
                  Effect.flatMap(() => {
                    requestState++;
                    return Effect.fail(new ClashApiError({ message: 'Retrying due to IP change', status: 403, cause: error }));
                  }),
                );
              }

              // Handle other transient HTTP status codes defined in HttpService.
              if (ERROR_STATUS_CODES.includes(error.status)) {
                requestState = 0;
                return Effect.fail(new ClashApiError({ message: 'Transient API error', status: error.status, cause: error }));
              }
            }

            // Catch malformed JSON responses which can happen during partial outages.
            if (error instanceof SyntaxError && error.message.includes('not valid JSON')) {
              return Effect.fail(new ClashApiError({ message: 'Invalid JSON response', status: 500, cause: error }));
            }

            return Effect.fail(new ClashApiError({ message: 'Request failed', cause: error }));
          }),
          Effect.retry({
            while: (error) => error instanceof ClashApiError && error.status !== 503,
            schedule: Schedule.spaced('10 seconds').pipe(Schedule.compose(Schedule.recurs(3))),
          }),
        );

        return res;
      }).pipe(Effect.provideService(HttpClient, http), Effect.orDie),
    );

  yield* login();

  const config = yield* configStore.get;
  client.addClans(config.clanTags as string[]);
  client.setClanEvent({ name: ClientEvents.ClanMember, filter: Boolean });

  yield* Effect.tryPromise({
    try: () => client.init(),
    catch: (error) => new ClashApiError({ message: 'Failed to initialize polling client', cause: error }),
  });

  return {
    client,
  } as const;
});

/**
 * Layer for providing the ClashService implementation.
 */
export const ClashServiceLayer = Layer.effect(ClashClientTag, createClashService);
