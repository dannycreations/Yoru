import { PollingClient as ClashClient, HTTPError } from 'clashofclans.js';
import { Context, Data, Effect, Layer, Schedule } from 'effect';

import { ConfigStore } from './ConfigService';
import { ERROR_CODES, HttpClient, waitForConnection } from './HttpService';

import type { RequestOptions } from 'clashofclans.js';

export class ClashApiError extends Data.TaggedError('ClashApiError')<{
  readonly message: string;
  readonly status?: number;
  readonly reason?: string;
  readonly cause?: unknown;
}> {}

export interface ClashService {
  readonly client: ClashClient;
}

export const ClashClientTag = Context.GenericTag<ClashService>('@services/ClashClient');

const createClashService = Effect.gen(function* (_) {
  const http = yield* _(HttpClient);
  const configStore = yield* _(ConfigStore);

  const client = new ClashClient({
    keys: [],
    pollingInterval: 60_000,
  });

  // Disable key re-validation as it's handled manually or not needed
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

  requestHandler.request = async <T>(path: string, options: RequestOptions = {}) => {
    return Effect.runPromise(
      Effect.gen(function* (_) {
        try {
          const res = yield* _(Effect.tryPromise(() => requestOrig<T>(path, options)));
          requestState = 0;
          return res;
        } catch (error) {
          if (requestState > 2) {
            requestState = 2;
            return yield* _(
              Effect.fail(
                new ClashApiError({
                  message: 'API problem, please check back later!',
                  cause: error,
                }),
              ),
            );
          }

          // Handle network connection issues by waiting for connection
          if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
            if (ERROR_CODES.includes(error.code)) {
              requestState = 0;
              yield* _(waitForConnection());
              return yield* _(Effect.fail(new ClashApiError({ message: 'Retrying after connection recovery', cause: error })));
            }
          }

          if (error instanceof HTTPError) {
            if (error.status === 503) {
              requestState = 0;
              return yield* _(
                Effect.fail(
                  new ClashApiError({
                    message: 'Service is temporarily unavailable because of maintenance!',
                    status: 503,
                  }),
                ),
              );
            }

            if (error.status === 403 && error.reason === 'accessDenied.invalidIp') {
              requestHandler['keys'].shift();
              ipFromError = error.message.match(/(\d{1,3}\.){3}\d+/)![0];

              yield* _(
                Effect.tryPromise(() =>
                  client.rest.login({
                    email: process.env.CLASH_EMAIL!,
                    password: process.env.CLASH_PASSWORD!,
                    keyName: 'Yoru',
                    keyCount: 1,
                  }),
                ),
              );

              requestState++;
              return yield* _(Effect.fail(new ClashApiError({ message: 'Retrying due to IP change', status: 403, cause: error })));
            }

            // Handle transient status codes with a retry
            if ([429, 500, 502, 504].includes(error.status)) {
              requestState = 0;
              // We fail with a TaggedError to trigger the Effect.retry logic defined below
              return yield* _(Effect.fail(new ClashApiError({ message: 'Transient API error', status: error.status, cause: error })));
            }
          }

          if (error instanceof SyntaxError && error.message.includes('not valid JSON')) {
            return yield* _(Effect.fail(new ClashApiError({ message: 'Invalid JSON response', cause: error })));
          }

          return yield* _(Effect.fail(new ClashApiError({ message: 'Request failed', cause: error })));
        }
      })
        .pipe(
          Effect.retry({
            // Retry on transient errors and IP changes, but NOT on 503 Maintenance
            while: (error) => error instanceof ClashApiError && error.status !== 503,
            // Legacy used 10s sleep for transient errors. Effect's exponential backoff is safer but we start with a decent delay
            schedule: Schedule.exponential('2 seconds').pipe(Schedule.compose(Schedule.recurs(3))),
          }),
        )
        .pipe(Effect.provideService(HttpClient, http)),
    );
  };

  // Perform login
  yield* _(
    Effect.tryPromise(() =>
      client.rest.login({
        email: process.env.CLASH_EMAIL!,
        password: process.env.CLASH_PASSWORD!,
        keyName: 'Yoru',
        keyCount: 1,
      }),
    ),
    Effect.mapError((error) => new ClashApiError({ message: 'Failed to login to Clash API', cause: error })),
  );

  // Setup polling events
  const config = yield* _(configStore.get);
  client.addClans(config.clanTags as string[]);
  client.setClanEvent({ name: 'ClanMember', filter: Boolean });

  // Initialize polling
  yield* _(
    Effect.tryPromise(() => client.init()),
    Effect.mapError((error) => new ClashApiError({ message: 'Failed to initialize polling client', cause: error })),
  );

  return {
    client,
  };
});

export const ClashServiceLayer = Layer.effect(ClashClientTag, createClashService);
