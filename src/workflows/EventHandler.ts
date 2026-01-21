import { PollingEvents } from 'clashofclans.js';
import { Effect, Layer, Scope } from 'effect';

import { ClashClientTag } from '../services/ClashService';
import { makeRuntimeBridge } from '../structures/RuntimeClient';
import { createClanMemberListener } from './listeners/ClanMemberListener';
import { createDiscordListener } from './listeners/DiscordListener';

export const EventHandler = Effect.gen(function* () {
  const { client } = yield* ClashClientTag;
  const bridge = yield* makeRuntimeBridge;
  const scope = yield* Effect.scope;

  const register = <Args extends readonly unknown[], R>(
    emitter: {
      readonly on: (event: string, cb: (...args: Args) => void) => void;
      readonly once?: (event: string, cb: (...args: Args) => void) => void;
    },
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
        { name: event },
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

  register(client, PollingEvents.Error, (error: unknown) => Effect.logError('Clash API Error', error));
});

export const EventHandlerLayer = Layer.effectDiscard(EventHandler);
