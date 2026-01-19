import { isErrorLike } from '@vegapunk/utilities/result';
import { Client, HTTPError } from 'clashofclans.js';
import { Cause, Chunk, Context, Data, Effect, Layer, Option, PubSub, Ref, Schedule } from 'effect';

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
  const loginSemaphore = yield* Effect.makeSemaphore(1);

  const handleRequestError = (cause: unknown, requestStateRef: Ref.Ref<number>) =>
    Effect.gen(function* () {
      const requestState = yield* Ref.get(requestStateRef);

      if (requestState > 2) {
        return yield* Effect.fail(
          new ClashError({
            message: 'API problem, please check back later!',
            cause,
          }),
        );
      }

      if (isErrorLike(cause) && ERROR_CODES.includes(cause.code)) {
        yield* waitForConnection();
        return yield* Effect.fail(
          new ClashError({
            message: 'Retrying after connection recovery',
            cause,
          }),
        );
      }

      if (cause instanceof HTTPError) {
        if (cause.status === 503) {
          return yield* Effect.fail(
            new ClashError({
              message: 'Service is temporarily unavailable!',
              status: 503,
            }),
          );
        }
        if (cause.status === 403) {
          if (cause.reason === 'accessDenied.invalidIp') {
            client.rest.requestHandler['keys'].shift();
            const ipMatch = cause.message.match(/(\d{1,3}\.){3}\d+/);
            yield* Ref.set(ipRef, ipMatch ? Option.some(ipMatch[0]) : Option.none());
          }

          yield* Effect.tryPromise({
            try: () =>
              client.rest.login({
                email: config.email,
                password: config.password,
                keyName: config.keyName ?? 'Yoru',
                keyCount: config.keyCount ?? 1,
              }),
            catch: (cause) =>
              new ClashError({
                message: 'Failed to login to Clash API',
                cause,
              }),
          }).pipe(loginSemaphore.withPermits(1));

          yield* Ref.update(requestStateRef, (s) => s + 1);
          return yield* Effect.fail(
            new ClashError({
              message: 'Retrying due to IP change',
              status: 403,
              cause,
            }),
          );
        }
        if (ERROR_STATUS_CODES.includes(cause.status)) {
          return yield* Effect.fail(
            new ClashError({
              message: 'Transient API error',
              status: cause.status,
              cause,
            }),
          );
        }
      }

      if (cause instanceof SyntaxError && cause.message.includes('not valid JSON')) {
        return yield* Effect.fail(
          new ClashError({
            message: 'Invalid JSON response',
            status: 500,
            cause,
          }),
        );
      }

      return yield* Effect.fail(
        new ClashError({
          message: 'Request failed',
          cause,
        }),
      );
    });

  client.rest.requestHandler['reValidateKeys'] = () => Promise.resolve();

  const requestHandler = client.rest.requestHandler;

  const getIpOrig = requestHandler['getIp'].bind(requestHandler) as (token: string) => Promise<void>;
  requestHandler['getIp'] = (token: string) =>
    bridge.promise(
      Ref.get(ipRef).pipe(
        Effect.flatMap((ipOpt) =>
          Option.match(ipOpt, {
            onNone: () => Effect.promise(() => getIpOrig(token)),
            onSome: (ip) => Ref.set(ipRef, Option.none()).pipe(Effect.as(ip)),
          }),
        ),
      ),
    );

  const requestOrig = requestHandler.request.bind(requestHandler);
  requestHandler.request = <T>(path: string, options: RequestOptions = {}) =>
    bridge.promise(
      Ref.make(0).pipe(
        Effect.flatMap((requestStateRef) =>
          Effect.gen(function* () {
            return yield* Effect.tryPromise({
              try: () => requestOrig<T>(path, options),
              catch: (error) => error,
            }).pipe(
              Effect.catchAll((error) => handleRequestError(error, requestStateRef)),
              Effect.catchAllCause((cause) =>
                Effect.gen(function* () {
                  const error = Cause.failureOption(cause);
                  if (Option.isSome(error) && error.value instanceof ClashError) {
                    return yield* Effect.fail(error.value);
                  }
                  return yield* Effect.fail(
                    new ClashError({
                      message: 'Request failed',
                      cause,
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
          ),
        ),
        Effect.provideService(HttpClientTag, http),
      ),
    );

  yield* Effect.gen(function* () {
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

  const addClans = (tags: readonly string[]) =>
    Ref.update(clanTags, (set) => {
      const next = new Set(set);
      tags.forEach((tag) => next.add(tag));
      return next;
    });

  const getClan = (tag: string) =>
    Effect.tryPromise({
      try: () => client.getClan(tag),
      catch: (cause) =>
        cause instanceof ClashError
          ? cause
          : new ClashError({
              message: `Failed to fetch clan ${tag}`,
              cause,
            }),
    });

  const getPlayer = (tag: string) =>
    Effect.tryPromise({
      try: () => client.getPlayer(tag),
      catch: (cause) =>
        cause instanceof ClashError
          ? cause
          : new ClashError({
              message: `Failed to fetch player ${tag}`,
              cause,
            }),
    });

  return {
    client,
    events,
    addClans,
    getClan,
    getPlayer,
  };
});

export const ClashClientLayer = Layer.scoped(ClashClientTag, makeClashClient);
