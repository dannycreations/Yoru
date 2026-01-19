import { isErrorLike } from '@vegapunk/utilities/result';
import { Client, HTTPError } from 'clashofclans.js';
import { Cause, Chunk, Context, Data, Deferred, Effect, Layer, Option, PubSub, Ref, Schedule } from 'effect';

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

export interface ClashClient {
  readonly client: Client;
  readonly events: PubSub.PubSub<ClashEvent>;
  readonly addClans: (tags: readonly string[]) => Effect.Effect<void>;
  readonly getClan: (tag: string) => Effect.Effect<Clan, ClashError>;
  readonly getPlayer: (tag: string) => Effect.Effect<Player, ClashError>;
}

export class ClashClientTag extends Context.Tag('@services/Clash')<ClashClientTag, ClashClient>() {}

const makeClashClient = Effect.gen(function* () {
  const http = yield* HttpClientTag;
  const config = yield* ClashConfigTag;
  const bridge = yield* makeBridge;

  const client = new Client({ keys: [] });

  const clanTags = yield* Ref.make(new Set<string>());
  const clanCache = yield* Ref.make(new Map<string, Clan>());
  const events = yield* PubSub.unbounded<ClashEvent>();
  const ipRef = yield* Ref.make(Option.none<string>());
  const rotationGate = yield* Ref.make(Option.none<Deferred.Deferred<void, never>>());
  const rotationVersion = yield* Ref.make(0);
  const rotationLock = yield* Effect.makeSemaphore(1);

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

  const requestHandler = client.rest.requestHandler;

  const getIpOrig = requestHandler['getIp'].bind(requestHandler);
  requestHandler['getIp'] = (token: string) =>
    bridge.sync(
      Ref.get(ipRef).pipe(
        Effect.flatMap((ipOpt) =>
          Option.match(ipOpt, {
            onNone: () => Effect.sync(() => getIpOrig(token)),
            onSome: (ip) => Ref.set(ipRef, Option.none()).pipe(Effect.as(ip)),
          }),
        ),
      ),
    );

  const requestOrig = requestHandler.request.bind(requestHandler);

  const requestStateRef = yield* Ref.make(0);

  requestHandler.request = async <T>(path: string, options: RequestOptions = {}) =>
    bridge.promise(
      Effect.gen(function* () {
        yield* Ref.get(rotationGate).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (d) => Deferred.await(d),
            }),
          ),
        );

        const startVersion = yield* Ref.get(rotationVersion);

        return yield* Effect.tryPromise(() => requestOrig<T>(path, options))
          .pipe(
            Effect.tap(() => Ref.set(requestStateRef, 0)),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const requestState = yield* Ref.get(requestStateRef);
                const isInvalidIp =
                  (error instanceof HTTPError && error.status === 403 && error.reason === 'accessDenied.invalidIp') ||
                  (isErrorLike<{ status?: number; reason?: string }>(error) && error.status === 403 && error.reason === 'accessDenied.invalidIp');

                if (requestState > 2) {
                  yield* Ref.set(requestStateRef, 2);
                  return yield* Effect.fail(
                    new ClashError({
                      message: 'API problem, please check back later!',
                      cause: error,
                    }),
                  );
                }

                if (isErrorLike(error) && ERROR_CODES.includes(error.code)) {
                  yield* Ref.set(requestStateRef, 0);
                  return yield* waitForConnection().pipe(
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
                    yield* Ref.set(requestStateRef, 0);
                    return yield* Effect.fail(
                      new ClashError({
                        message: 'Service is temporarily unavailable because of maintenance!',
                        status: 503,
                      }),
                    );
                  }

                  if (isInvalidIp) {
                    yield* rotationLock.withPermits(1)(
                      Effect.gen(function* () {
                        const currentVersion = yield* Ref.get(rotationVersion);
                        if (currentVersion === startVersion) {
                          const d = yield* Deferred.make<void, never>();
                          yield* Ref.set(rotationGate, Option.some(d));

                          yield* Effect.gen(function* () {
                            requestHandler['keys'].shift();
                            const message = isErrorLike<{ message: string }>(error) ? error.message : String(error);
                            const ipMatch = message.match(/(\d{1,3}\.){3}\d+/);
                            if (ipMatch) yield* Ref.set(ipRef, Option.some(ipMatch[0]));
                            yield* login();
                            yield* Ref.update(rotationVersion, (v) => v + 1);
                          }).pipe(
                            Effect.ensuring(
                              Effect.gen(function* () {
                                yield* Ref.set(rotationGate, Option.none());
                                yield* Deferred.succeed(d, undefined);
                              }),
                            ),
                            Effect.catchAll(() => Effect.void),
                          );
                        }
                      }),
                    );

                    yield* Ref.update(requestStateRef, (s) => s + 1);
                    return yield* Effect.fail(
                      new ClashError({
                        message: 'Retrying due to IP change',
                        status: 403,
                        cause: error,
                      }),
                    );
                  }

                  if (ERROR_STATUS_CODES.includes(error.status)) {
                    yield* Ref.set(requestStateRef, 0);
                    return yield* Effect.fail(
                      new ClashError({
                        message: 'Transient API error',
                        status: error.status,
                        cause: error,
                      }),
                    );
                  }
                }

                if (error instanceof SyntaxError && error.message.includes('not valid JSON')) {
                  return yield* Effect.fail(
                    new ClashError({
                      message: 'Invalid JSON response',
                      status: 500,
                      cause: error,
                    }),
                  );
                }

                return yield* Effect.fail(
                  new ClashError({
                    message: 'Request failed',
                    cause: error,
                  }),
                );
              }),
            ),
          )
          .pipe(
            Effect.catchAllCause((cause) =>
              Effect.gen(function* () {
                const error = Cause.failureOption(cause);
                if (Option.isSome(error) && error.value instanceof ClashError) {
                  return yield* Effect.fail(error.value);
                }
                return yield* Effect.fail(
                  new ClashError({
                    message: 'Request failed',
                    cause: cause,
                  }),
                );
              }),
            ),
          );
      }).pipe(
        Effect.retry({
          while: (error) => error instanceof ClashError && error.status !== 503,
          schedule: Schedule.spaced('10 seconds').pipe(Schedule.compose(Schedule.recurs(3))),
        }),
        Effect.provideService(HttpClientTag, http),
      ),
    );

  yield* login();

  const poll = Effect.gen(function* () {
    const tags = yield* Ref.get(clanTags);
    const cache = yield* Ref.get(clanCache);

    const updates = yield* Effect.forEach(
      tags,
      (tag) =>
        Effect.gen(function* () {
          const newClan = yield* Effect.tryPromise({
            try: () => client.getClan(tag),
            catch: () => null,
          }).pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (!newClan) return Option.none();

          const oldClan = cache.get(tag);
          if (oldClan) {
            yield* PubSub.publish(events, {
              _tag: ClientEvents.ClanMember,
              oldClan,
              newClan,
            });
          }

          return Option.some({ tag, newClan });
        }),
      { concurrency: 'unbounded' },
    ).pipe(Effect.map((arr) => Chunk.compact(Chunk.fromIterable(arr))));

    yield* Ref.update(clanCache, (prev) =>
      Chunk.reduce(updates, new Map(prev), (next, update) => {
        next.set(update.tag, update.newClan);
        return next;
      }),
    );
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
        tags.forEach((tag) => next.add(tag));
        return next;
      }),
    getClan,
    getPlayer,
  };
});

export const ClashClientLayer = Layer.scoped(ClashClientTag, makeClashClient);
