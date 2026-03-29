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
        return yield* new ClashError({
          message: 'API problem, please check back later!',
          cause,
        });
      }

      const isNetwork = isErrorLike<{ readonly code: string }>(cause) && ERROR_CODES.has(cause.code);

      if (isNetwork) {
        yield* waitForConnection();

        return yield* new ClashError({
          message: 'Retrying after connection recovery',
          cause,
        });
      }

      if (!(cause instanceof HTTPError)) {
        return yield* new ClashError({
          message: 'Request failed',
          cause,
        });
      }

      if (cause.status === 503) {
        return yield* new ClashError({
          message: 'Service is temporarily unavailable!',
          status: 503,
        });
      }

      if (cause.status === 403) {
        const isIpDenied = cause.reason === 'accessDenied.invalidIp';

        if (isIpDenied) {
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

        return yield* new ClashError({
          message: 'Retrying due to IP change',
          status: 403,
          cause,
        });
      }

      if (ERROR_STATUS_CODES.has(cause.status)) {
        return yield* new ClashError({
          message: 'Transient API error',
          status: cause.status,
          cause,
        });
      }

      return yield* new ClashError({
        message: 'Request failed',
        cause,
      });
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
          catch: (cause) =>
            new ClashError({
              message: 'Request failed',
              cause,
            }),
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
      let changed = false;
      for (const tag of tags) {
        if (next.has(tag)) {
          continue;
        }

        next.add(tag);
        changed = true;
      }
      return changed ? next : set;
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
    if (tags.size === 0) {
      return;
    }

    const cache = yield* Ref.get(clanCache);

    const updates = yield* Effect.forEach(
      tags,
      (tag) =>
        getClan(tag).pipe(
          Effect.map((newClan) => {
            const oldClan = cache.get(tag);
            if (!oldClan) {
              return { tag, newClan, oldClan, changed: true };
            }

            if (oldClan.memberCount !== newClan.memberCount) {
              return { tag, newClan, oldClan, changed: true };
            }

            const oldMembers = oldClan.members;
            const newMembers = newClan.members;

            const isIdentical =
              oldMembers.length === newMembers.length &&
              oldMembers.every((m, i) => {
                const nm = newMembers[i];
                return nm && m.tag === nm.tag && m.role === nm.role;
              });

            if (!isIdentical) {
              return { tag, newClan, oldClan, changed: true };
            }

            return { tag, newClan, changed: false };
          }),
          Effect.option,
        ),
      { concurrency: 'inherit' },
    ).pipe(Effect.map((arr) => Array.fromIterable(Chunk.compact(Chunk.fromIterable(arr)))));

    if (updates.length === 0) {
      return;
    }

    yield* Ref.update(clanCache, (prev) => {
      const next = new Map(prev);
      for (const update of updates) {
        next.set(update.tag, update.newClan);
      }
      return next;
    });

    yield* Effect.forEach(
      updates,
      (u) => {
        if (!u.changed) {
          return Effect.void;
        }

        if (!u.oldClan) {
          return Effect.void;
        }

        return PubSub.publish(events, {
          _tag: ClientEvents.ClanMember,
          oldClan: u.oldClan,
          newClan: u.newClan,
        });
      },
      { concurrency: 'inherit' },
    );
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
