import { it as itBase } from '@effect/vitest';
import { HttpError, RequestHandler } from 'clashofclans.js';
import { Cause, Effect, Exit, Fiber, Layer, Option, TestClock } from 'effect';
import { afterEach, beforeEach, expect, vi } from 'vitest';

import { EnvTag } from '../core/schemas';
import { HttpClientTag } from '../structures/HttpClient';
import { ClashClientLayer, ClashClientTag, ClashConfigTag } from './ClashService';

// Adapt itBase.effect to it.effect in a type-safe manner
const it = Object.assign((...args: Parameters<typeof itBase>) => itBase(...args), itBase) as any;

let requestSpy: any;

beforeEach(() => {
  requestSpy = vi.spyOn(RequestHandler.prototype, 'request');
});

afterEach(() => {
  requestSpy.mockRestore();
});

it.effect('should immediately fail with ClashError and status 404 on player not found (no infinite retry)', () => {
  const httpError = new HttpError({ message: 'Player not found', reason: 'notFound' }, 404, '/players/%23Q8JVG9GRC', 0, 'GET');

  // Mock RequestHandler.prototype.request to fail with 404
  requestSpy.mockRejectedValue(httpError);

  const mockHttpClient = {
    request: vi.fn(),
    waitForConnection: vi.fn(() => Effect.void),
  };

  const testEnv = Layer.mergeAll(
    Layer.succeed(HttpClientTag, mockHttpClient),
    Layer.succeed(ClashConfigTag, { email: 'test@example.com', password: 'password', pollingInterval: 999999 }),
    Layer.succeed(EnvTag, {
      NODE_ENV: 'test',
      DISCORD_TOKEN: 'token',
      CLASH_EMAIL: 'test@example.com',
      CLASH_PASSWORD: 'password',
    }),
  );

  const finalLayer = ClashClientLayer.pipe(Layer.provideMerge(testEnv));

  return Effect.gen(function* () {
    const clash = yield* ClashClientTag;
    const result = yield* clash.getPlayer('#Q8JVG9GRC').pipe(Effect.exit);

    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      const cause = result.cause;
      const errorOpt = Cause.failureOption(cause);
      expect(Option.isSome(errorOpt)).toBe(true);
      if (Option.isSome(errorOpt)) {
        const error: any = errorOpt.value;
        expect(error._tag).toBe('ClashError');
        expect(error.status).toBe(404);
        expect(error.reason).toBe('notFound');
      }
    }

    // Verify it was only called once, i.e., no retries occurred
    expect(requestSpy).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(finalLayer));
});

it.effect('should retry on transient 500 error and eventually succeed', () => {
  const httpError500 = new HttpError({ message: 'Internal Server Error', reason: 'unknownException' }, 500, '/players/%23Q8JVG9GRC', 0, 'GET');

  // Mock request: first fails with 500, second succeeds with dummy player data
  const dummyPlayer = {
    name: 'Test Player',
    tag: '#Q8JVG9GRC',
    townHallLevel: 14,
    troops: [],
    heroes: [],
    spells: [],
    achievements: [],
    labels: [],
    heroEquipment: [],
  };
  requestSpy.mockRejectedValueOnce(httpError500).mockResolvedValueOnce({ body: dummyPlayer });

  const mockHttpClient = {
    request: vi.fn(),
    waitForConnection: vi.fn(() => Effect.void),
  };

  const testEnv = Layer.mergeAll(
    Layer.succeed(HttpClientTag, mockHttpClient),
    Layer.succeed(ClashConfigTag, { email: 'test@example.com', password: 'password', pollingInterval: 999999 }),
    Layer.succeed(EnvTag, {
      NODE_ENV: 'test',
      DISCORD_TOKEN: 'token',
      CLASH_EMAIL: 'test@example.com',
      CLASH_PASSWORD: 'password',
    }),
  );

  const finalLayer = ClashClientLayer.pipe(Layer.provideMerge(testEnv));

  return Effect.gen(function* () {
    const clash = yield* ClashClientTag;
    const fiber = yield* Effect.fork(clash.getPlayer('#Q8JVG9GRC'));

    // Advance virtual clock by 11 seconds to trigger retry
    yield* TestClock.adjust('11 seconds');

    const result = yield* Fiber.join(fiber).pipe(Effect.exit);

    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) {
      const player = result.value;
      expect(player.name).toBe(dummyPlayer.name);
      expect(player.tag).toBe(dummyPlayer.tag);
      expect(player.townHallLevel).toBe(dummyPlayer.townHallLevel);
    }
    expect(requestSpy).toHaveBeenCalledTimes(2);
  }).pipe(Effect.provide(finalLayer));
});
