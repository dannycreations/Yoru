import { chalk } from '@vegapunk/utilities';
import { isErrorLike } from '@vegapunk/utilities/result';
import { Cause, Data, Effect, Fiber, Schedule } from 'effect';

export class ScheduleRestart extends Data.TaggedError('ScheduleRestart') {}

export interface RuntimeOptions {
  readonly maxRestarts?: number;
  readonly intervalMs?: number;
  readonly restartDelayMs?: number;
}

export const runForkWithCleanUp = <A, E, R>(effect: Effect.Effect<A, E, R>): void => {
  const fiber = Effect.runFork(effect as Effect.Effect<A, E>);
  process.on('SIGINT', () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => process.exit(0)));
  process.on('SIGTERM', () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => process.exit(0)));
};

export const cycleWithRestart = <A, E, R>(program: Effect.Effect<A, E, R>, options: RuntimeOptions = {}): Effect.Effect<void, never, R> => {
  const { maxRestarts = 3, intervalMs = 60_000, restartDelayMs = 5_000 } = options;
  const restartTimes: number[] = [];

  const loop = Effect.catchAllCause(program, (cause) =>
    Effect.gen(function* () {
      const failures = Array.from(Cause.failures(cause));

      const isRestart = failures.some((error) => isErrorLike<{ _tag: string }>(error) && error._tag === 'ScheduleRestart');

      if (isRestart) {
        yield* Effect.logInfo(chalk`{bold.yellow Scheduled restart triggered.}`);
        return;
      }

      for (const failure of failures) {
        if (isErrorLike<{ code?: string }>(failure) && failure.code === 'ENOTFOUND') {
          yield* Effect.logWarning('Network error (ENOTFOUND) detected, skipping fatal crash.');
          return;
        }
      }

      const now = Date.now();
      restartTimes.push(now);

      const recentRestarts = restartTimes.filter((t) => now - t < intervalMs);
      restartTimes.length = 0;
      restartTimes.push(...recentRestarts);

      if (restartTimes.length >= maxRestarts) {
        yield* Effect.logFatal(chalk`{bold.red System crashed too many times (${maxRestarts}+ in ${intervalMs / 1000}s). Shutting down...}`);
        yield* Effect.logError(cause);
        process.exit(1);
      }

      yield* Effect.logError(chalk`{bold.red System encountered an error:}`, cause);
      yield* Effect.logInfo(chalk`{bold.yellow System restarting in ${restartDelayMs / 1000} seconds...}`, cause);
      yield* Effect.sleep(`${restartDelayMs} millis`);
    }),
  );

  return Effect.repeat(loop, Schedule.forever).pipe(Effect.asVoid);
};

export const cycleMidnightRestart = Effect.gen(function* () {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  yield* Effect.sleep(`${msUntilMidnight} millis`);
  yield* Effect.logInfo(chalk`{bold.yellow It's midnight time. Restarting app...}`);
  return yield* Effect.fail(new ScheduleRestart());
});
