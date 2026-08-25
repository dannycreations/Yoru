import { Effect, Layer, Scope } from 'effect';

import { ClashClientTag } from '../services/ClashService.js';
import { makeRuntimeBridge } from '../structures/RuntimeClient.js';
import { createClanMemberListener } from './listeners/ClanMemberListener.js';
import { createDiscordListener } from './listeners/DiscordListener.js';

type EventEmitter<Args extends readonly unknown[]> = {
  readonly on: (event: string, cb: (...args: Args) => void) => void;
  readonly once?: (event: string, cb: (...args: Args) => void) => void;
};

export type EventRegister = <Args extends readonly unknown[], R>(
  emitter: EventEmitter<Args>,
  event: string,
  handler: (...args: Args) => Effect.Effect<void, unknown, R>,
  once?: boolean,
) => void;

export const EventHandler = Effect.gen(function* () {
  const { client } = yield* ClashClientTag;
  const bridge = yield* makeRuntimeBridge;
  const scope = yield* Effect.scope;

  const register: EventRegister = <Args extends readonly unknown[], R>(
    emitter: EventEmitter<Args>,
    event: string,
    handler: (...args: Args) => Effect.Effect<void, unknown, R>,
    once = false,
  ): void => {
    const cb = (...args: Args) => {
      bridge.runFork(
        handler(...args).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.catchAllCause((cause) => Effect.logError(`Unhandled error in event ${event}`, cause)),
        ),
      );
    };

    if (once && emitter.once) {
      emitter.once(event, cb);
    } else {
      emitter.on(event, cb);
    }
  };

  yield* createDiscordListener(register);
  yield* createClanMemberListener();

  register(client, 'error', (error: unknown) => Effect.logError('Clash API Error', error));
});

export const EventHandlerLayer = Layer.effectDiscard(EventHandler);
