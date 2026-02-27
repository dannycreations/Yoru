import { isErrorLike } from '@vegapunk/utilities/result';
import { Client, HTTPError } from 'clashofclans.js';
import { Array, Cause, Chunk, Context, Data, Effect, Layer, Option, PubSub, Ref, Schedule } from 'effect';

import { ClientEvents } from '../core/constants';
import { EnvTag } from '../core/schemas';
import { ERROR_CODES, ERROR_STATUS_CODES, HttpClientTag, waitForConnection } from '../structures/HttpClient';
import { makeRuntimeBridge } from '../structures/RuntimeClient';

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
  readonly addClans: (tags: ReadonlyArray<string>) => Effect.Effect<void>;
  readonly getClan: (tag: string) => Effect.Effect<Clan, ClashError>;
  readonly getPlayer: (tag: string) => Effect.Effect<Player, ClashError>;
}

export class ClashClientTag extends Context.Tag('@services/Clash')<ClashClientTag, ClashClient>() {}

const makeClashClient = Effect.gen(function* () {
  const http = yield* HttpClientTag;
  const config = yield* ClashConfigTag;
  const bridge = yield* makeRuntimeBridge;

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

      if (isErrorLike<{ readonly code: string }>(cause) && ERROR_CODES.has(cause.code)) {
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
            yield* Ref.set(ipRef, Option.fromNullable(ipMatch?.[0]));
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
        if (ERROR_STATUS_CODES.has(cause.status)) {
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

  const getIpOrig = requestHandler['getIp'].bind(requestHandler) as (token: string) => Promise<string>;
  requestHandler['getIp'] = (token: string) =>
    bridge.runPromise(
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
    bridge.runPromise(
      Effect.gen(function* () {
        const requestStateRef = yield* Ref.make(0);
        return yield* Effect.tryPromise({
          try: () => requestOrig<T>(path, options),
          catch: (cause) => cause,
        }).pipe(
          Effect.catchAll((cause) => handleRequestError(cause, requestStateRef)),
          Effect.catchAllCause((cause) =>
            Option.match(Cause.failureOption(cause), {
              onNone: () =>
                Effect.fail(
                  new ClashError({
                    message: 'Request failed',
                    cause,
                  }),
                ),
              onSome: (error) =>
                error instanceof ClashError
                  ? Effect.fail(error)
                  : Effect.fail(
                      new ClashError({
                        message: 'Request failed',
                        cause: error,
                      }),
                    ),
            }),
          ),
          Effect.retry({
            while: (error) => error instanceof ClashError && error.status !== 503,
            schedule: Schedule.spaced('10 seconds'),
          }),
        );
      }).pipe(Effect.provideService(HttpClientTag, http)),
    );
  const addClans = (tags: readonly string[]) =>
    Ref.update(clanTags, (set) => {
      const next = new Set(set);
      Array.forEach(tags, (tag) => next.add(tag));
      return next;
    });

  const getClan = (tag: string) =>
    Effect.tryPromise({
      try: () => client.getClan(tag),
      catch: (cause) =>
        new ClashError({
          message: `Failed to fetch clan ${tag}`,
          cause,
        }),
    });

  const getPlayer = (tag: string) =>
    Effect.tryPromise({
      try: () => client.getPlayer(tag),
      catch: (cause) =>
        new ClashError({
          message: `Failed to fetch player ${tag}`,
          cause,
        }),
    });

  yield* Effect.gen(function* () {
    const tags = yield* Ref.get(clanTags);
    if (tags.size === 0) return;

    const cache = yield* Ref.get(clanCache);

    const updates = yield* Effect.forEach(
      tags,
      (tag) =>
        getClan(tag).pipe(
          Effect.map((newClan) => {
            const oldClan = cache.get(tag);
            if (oldClan && oldClan.memberCount === newClan.memberCount) {
              const isIdentical = oldClan.members.every((m, i) => m.tag === newClan.members[i]?.tag && m.role === newClan.members[i]?.role);
              if (isIdentical) return { tag, newClan, changed: false };
            }
            return { tag, newClan, oldClan, changed: true };
          }),
          Effect.option,
        ),
      { concurrency: 'inherit' },
    ).pipe(Effect.map((arr) => Chunk.compact(Chunk.fromIterable(arr))));

    if (updates.length > 0) {
      yield* Ref.update(clanCache, (prev) => {
        const next = new Map(prev);
        for (const update of updates) {
          next.set(update.tag, update.newClan);
        }
        return next;
      });

      yield* Effect.forEach(
        updates,
        (u) =>
          u.changed && u.oldClan
            ? PubSub.publish(events, {
                _tag: ClientEvents.ClanMember,
                oldClan: u.oldClan,
                newClan: u.newClan,
              })
            : Effect.void,
        { concurrency: 'inherit' },
      );
    }
  }).pipe(
    Effect.catchAllCause((cause) => Effect.logError('Clash polling failure', cause)),
    Effect.repeat(Schedule.spaced(config.pollingInterval ?? 60_000)),
    Effect.forkScoped,
  );

  return {
    client,
    events,
    addClans,
    getClan,
    getPlayer,
  };
});

export const ClashClientLayer = Layer.scoped(ClashClientTag, makeClashClient);

export const ClashConfigLayer = Layer.effect(
  ClashConfigTag,
  Effect.gen(function* () {
    const env = yield* EnvTag;
    return {
      email: env.CLASH_EMAIL,
      password: env.CLASH_PASSWORD,
    };
  }),
);
