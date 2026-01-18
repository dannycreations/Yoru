import { PollingEvents } from 'clashofclans.js';
import { Effect, Layer, Scope } from 'effect';

import { ClashTag } from '../services/ClashService';
import { makeBridge } from '../structures/RuntimeClient';
import { createClanMemberListener } from './listeners/ClanMemberListener';
import { createDiscordListener } from './listeners/DiscordListener';

export const EventHandler = Effect.gen(function* () {
  const { client } = yield* ClashTag;
  const bridge = yield* makeBridge;
  const scope = yield* Effect.scope;

  const register = (
    emitter: { on: (event: string, cb: (...args: any[]) => void) => void; once?: (event: string, cb: (...args: any[]) => void) => void },
    event: string,
    handler: (...args: any[]) => Effect.Effect<void, unknown, any>,
    once = false,
  ) => {
    const cb = (...args: any[]) =>
      bridge.fork(
        handler(...args).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.catchAllCause((cause) => Effect.logError(`Unhandled error in event ${event}`, cause)),
        ),
        { name: event },
      );

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
