import { isErrorLike } from '@vegapunk/utilities/result';
import { Client, HTTPError } from 'clashofclans.js';
import { Context, Data, Effect, Layer, PubSub, Ref, Schedule } from 'effect';

import { ClientEvents } from '../core/constants';
import { ERROR_CODES, ERROR_STATUS_CODES, HttpTag, waitForConnection } from './HttpService';

import type { Clan, Player, RequestOptions } from 'clashofclans.js';

export type ClashEvent = {
  readonly _tag: typeof ClientEvents.ClanMember;
  readonly oldClan: Clan;
  readonly newClan: Clan;
};

export class ClashError extends Data.TaggedError('ClashError')<{
  readonly message: string;
  readonly status?: number;
  readonly reason?: string;
  readonly cause?: unknown;
}> {}

export interface ClashConfig {
  readonly email: string;
  readonly password: string;
  readonly keyName?: string;
  readonly keyCount?: number;
  readonly pollingInterval?: number;
}

export const ClashConfigTag = Context.GenericTag<ClashConfig>('@config/ClashConfig');

export interface ClashLayer {
  readonly client: Client;
  readonly events: PubSub.PubSub<ClashEvent>;
  readonly addClans: (tags: string[]) => Effect.Effect<void>;
  readonly getClan: (tag: string) => Effect.Effect<Clan, ClashError>;
  readonly getPlayer: (tag: string) => Effect.Effect<Player, ClashError>;
}

export const ClashTag = Context.GenericTag<ClashLayer>('@layer/ClashLayer');

const createClash = Effect.gen(function* () {
  const http = yield* HttpTag;
  const config = yield* ClashConfigTag;

  const client = new Client({ keys: [] });

  const clanTags = yield* Ref.make(new Set<string>());
  const clanCache = yield* Ref.make(new Map<string, Clan>());
  const events = yield* PubSub.unbounded<ClashEvent>();

  const login = () =>
    Effect.tryPromise({
      try: () =>
        client.rest.login({
          email: config.email,
          password: config.password,
          keyName: config.keyName ?? 'Yoru',
          keyCount: config.keyCount ?? 1,
        }),
      catch: (error) =>
        new ClashError({
          message: 'Failed to login to Clash API',
          cause: error,
        }),
    });

  // Overriding internal library methods allows for the implementation of custom behavior.
  client.rest.requestHandler['reValidateKeys'] = () => Promise.resolve();

  // Maintenance of internal request state enables retry logic and prevents infinite loops during persistent API issues.
  let ipFromError: string | undefined;

  const requestHandler = client.rest.requestHandler;

  // Internal IP detection uses addresses extracted from previous authentication errors to facilitate faster recovery during IP changes.
  const getIpOrig = requestHandler['getIp'].bind(requestHandler);
  requestHandler['getIp'] = (token: string) => {
    const ip = ipFromError;
    if (ip) {
      ipFromError = undefined;
      return ip;
    }
    return getIpOrig(token);
  };

  const requestOrig = requestHandler.request.bind(requestHandler);

  // The internal request method is wrapped with Effect-based logic to provide robust error handling, connection monitoring, and automated retries.
  requestHandler.request = async <T>(path: string, options: RequestOptions = {}) => {
    // Encapsulating the request state within the function scope ensures that retry counters are isolated to each individual request and avoids race conditions in concurrent operations.
    let requestState = 0;
    return Effect.runPromise(
      Effect.gen(function* () {
        return yield* Effect.tryPromise(() => requestOrig<T>(path, options)).pipe(
          Effect.tap(() => (requestState = 0)),
          Effect.catchAll((error) => {
            // Capping retry attempts for non-transient failures prevents excessive resource consumption.
            if (requestState > 2) {
              requestState = 2;
              return Effect.fail(
                new ClashError({
                  message: 'API problem, please check back later!',
                  cause: error,
                }),
              );
            }

            // Monitoring network connectivity ensures recovery before retrying network-level failures.
            if (isErrorLike(error) && ERROR_CODES.includes(error.code)) {
              requestState = 0;
              return waitForConnection().pipe(
                Effect.flatMap(() =>
                  Effect.fail(
                    new ClashError({
                      message: 'Retrying after connection recovery',
                      cause: error,
                    }),
                  ),
                ),
              );
            }

            if (error instanceof HTTPError) {
              // Terminal handling of service maintenance (503) avoids unnecessary retries during the current request cycle.
              if (error.status === 503) {
                requestState = 0;
                return Effect.fail(
                  new ClashError({
                    message: 'Service is temporarily unavailable because of maintenance!',
                    status: 503,
                  }),
                );
              }

              // IP-related access denials trigger key rotation and re-authentication with the new IP address.
              if (error.status === 403 && error.reason === 'accessDenied.invalidIp') {
                requestHandler['keys'].shift();
                const ipMatch = error.message.match(/(\d{1,3}\.){3}\d+/);
                // Selective extraction of the IP address from the error message ensures that re-authentication uses the correct origin for new keys.
                if (ipMatch) ipFromError = ipMatch[0];
                return login().pipe(
                  Effect.flatMap(() => {
                    requestState++;
                    return Effect.fail(
                      new ClashError({
                        message: 'Retrying due to IP change',
                        status: 403,
                        cause: error,
                      }),
                    );
                  }),
                );
              }

              if (ERROR_STATUS_CODES.includes(error.status)) {
                requestState = 0;
                return Effect.fail(
                  new ClashError({
                    message: 'Transient API error',
                    status: error.status,
                    cause: error,
                  }),
                );
              }
            }

            if (error instanceof SyntaxError && error.message.includes('not valid JSON')) {
              return Effect.fail(
                new ClashError({
                  message: 'Invalid JSON response',
                  status: 500,
                  cause: error,
                }),
              );
            }

            return Effect.fail(
              new ClashError({
                message: 'Request failed',
                cause: error,
              }),
            );
          }),
          Effect.retry({
            while: (error) => error instanceof ClashError && error.status !== 503,
            // Retrying at fixed intervals ensures that transient API or network issues are given time to resolve before the request is considered failed.
            schedule: Schedule.spaced('10 seconds').pipe(Schedule.compose(Schedule.recurs(3))),
          }),
        );
      }).pipe(Effect.provideService(HttpTag, http)),
    );
  };

  yield* login();

  const poll = Effect.gen(function* () {
    const tags = yield* Ref.get(clanTags);
    const cache = yield* Ref.get(clanCache);

    const updates = yield* Effect.all(
      Array.from(tags).map((tag) =>
        // Individual clan fetch failures are converted to null to prevent a single failing request from terminating the entire polling cycle.
        Effect.tryPromise({
          try: () => client.getClan(tag),
          catch: (error) => error,
        }).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
          Effect.flatMap((newClan) => {
            if (!newClan) return Effect.succeed(null);
            const oldClan = cache.get(tag);
            const publish = oldClan
              ? PubSub.publish(events, {
                  _tag: ClientEvents.ClanMember,
                  oldClan,
                  newClan,
                } as const)
              : Effect.void;
            return publish.pipe(Effect.as({ tag, newClan }));
          }),
        ),
      ),
      { concurrency: 'unbounded' },
    );

    // Updating the clan cache with the latest data from the polling cycle ensures that subsequent comparisons use the most recent state.
    yield* Ref.update(clanCache, (prev) => {
      const next = new Map(prev);
      for (const update of updates) {
        if (update) next.set(update.tag, update.newClan);
      }
      return next;
    });
  }).pipe(
    Effect.catchAllCause((cause) => Effect.logError('Clash polling failure', cause)),
    Effect.repeat(Schedule.spaced(config.pollingInterval ?? 60_000)),
    Effect.forkDaemon,
  );

  yield* poll;

  const getClan = (tag: string) =>
    Effect.tryPromise({
      try: () => client.getClan(tag),
      catch: (error) =>
        error instanceof ClashError
          ? error
          : new ClashError({
              message: `Failed to fetch clan ${tag}`,
              cause: error,
            }),
    });

  const getPlayer = (tag: string) =>
    Effect.tryPromise({
      try: () => client.getPlayer(tag),
      catch: (error) =>
        error instanceof ClashError
          ? error
          : new ClashError({
              message: `Failed to fetch player ${tag}`,
              cause: error,
            }),
    });

  return {
    client,
    events,
    addClans: (tags: string[]) =>
      Ref.update(clanTags, (set) => {
        const next = new Set(set);
        for (const tag of tags) next.add(tag);
        return next;
      }),
    getClan,
    getPlayer,
  } as const;
});

export const ClashLayer = Layer.effect(ClashTag, createClash);
