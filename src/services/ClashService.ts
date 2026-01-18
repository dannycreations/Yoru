import { isErrorLike } from '@vegapunk/utilities/result';
import { Client, HTTPError } from 'clashofclans.js';
import { Context, Data, Effect, Layer, PubSub, Ref, Schedule } from 'effect';

import { ClientEvents } from '../core/constants';
import { ERROR_CODES, ERROR_STATUS_CODES, HttpClientTag, waitForConnection } from '../structures/HttpClient';
import { makeBridge } from '../structures/RuntimeClient';

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

export class ClashConfigTag extends Context.Tag('@services/ClashConfig')<ClashConfigTag, ClashConfig>() {}

export interface ClashLayer {
  readonly client: Client;
  readonly events: PubSub.PubSub<ClashEvent>;
  readonly addClans: (tags: readonly string[]) => Effect.Effect<void>;
  readonly getClan: (tag: string) => Effect.Effect<Clan, ClashError>;
  readonly getPlayer: (tag: string) => Effect.Effect<Player, ClashError>;
}

export class ClashTag extends Context.Tag('@services/Clash')<ClashTag, ClashLayer>() {}

const makeClashClient = Effect.gen(function* () {
  const http = yield* HttpClientTag;
  const config = yield* ClashConfigTag;
  const bridge = yield* makeBridge;

  const client = new Client({ keys: [] });

  const clanTags = yield* Ref.make(new Set<string>());
  const clanCache = yield* Ref.make(new Map<string, Clan>());
  const events = yield* PubSub.unbounded<ClashEvent>();

  const login = () =>
    Effect.gen(function* () {
      yield* Effect.tryPromise({
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
    });

  client.rest.requestHandler['reValidateKeys'] = () => Promise.resolve();

  let ipFromError: string | undefined;

  const requestHandler = client.rest.requestHandler;

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

  requestHandler.request = async <T>(path: string, options: RequestOptions = {}) => {
    let requestState = 0;
    return bridge.promise(
      Effect.gen(function* () {
        return yield* Effect.tryPromise(() => requestOrig<T>(path, options)).pipe(
          Effect.tap(() => (requestState = 0)),
          Effect.catchAll((error) => {
            if (requestState > 2) {
              requestState = 2;
              return Effect.fail(
                new ClashError({
                  message: 'API problem, please check back later!',
                  cause: error,
                }),
              );
            }

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
              if (error.status === 503) {
                requestState = 0;
                return Effect.fail(
                  new ClashError({
                    message: 'Service is temporarily unavailable because of maintenance!',
                    status: 503,
                  }),
                );
              }

              if (error.status === 403 && error.reason === 'accessDenied.invalidIp') {
                requestHandler['keys'].shift();
                const ipMatch = error.message.match(/(\d{1,3}\.){3}\d+/);
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
            schedule: Schedule.spaced('10 seconds').pipe(Schedule.compose(Schedule.recurs(3))),
          }),
        );
      }).pipe(Effect.provideService(HttpClientTag, http)),
    );
  };

  yield* login();

  const poll = Effect.gen(function* () {
    const tags = yield* Ref.get(clanTags);
    const cache = yield* Ref.get(clanCache);

    const updates = yield* Effect.all(
      Array.from(tags).map((tag) =>
        Effect.gen(function* () {
          const newClan = yield* Effect.tryPromise({
            try: () => client.getClan(tag),
            catch: () => null,
          }).pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (!newClan) return null;

          const oldClan = cache.get(tag);
          if (oldClan) {
            yield* PubSub.publish(events, {
              _tag: ClientEvents.ClanMember,
              oldClan,
              newClan,
            });
          }

          return { tag, newClan };
        }),
      ),
      { concurrency: 'unbounded' },
    );

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
    Effect.fork,
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
    addClans: (tags: readonly string[]) =>
      Ref.update(clanTags, (set) => {
        const next = new Set(set);
        for (const tag of tags) {
          next.add(tag);
        }
        return next;
      }),
    getClan,
    getPlayer,
  };
});

export const ClashLayer = Layer.scoped(ClashTag, makeClashClient);
