import { PollingEvents } from 'clashofclans.js';
import { Effect, Layer, Runtime } from 'effect';

import { ClashTag } from '../services/ClashService';
import { createClanMemberListener } from './listeners/ClanMemberListener';
import { createDiscordListener } from './listeners/DiscordListener';

// The EventHandler orchestrates the registration of all system listeners, providing a centralized runtime and registration utility for both Discord and Clash of Clans event emitters.
export const EventHandler = Effect.gen(function* () {
  const { client: clash } = yield* ClashTag;
  const runtime = yield* Effect.runtime<any>();

  const register = (
    emitter: { on: Function; once?: Function },
    event: string,
    handler: (...args: any[]) => Effect.Effect<void, any, any>,
    once = false,
  ) => {
    const cb = (...args: any[]) =>
      Runtime.runFork(runtime)(Effect.catchAllCause(handler(...args), (cause) => Effect.logError(`Unhandled error in ${event} handler`, cause)));
    if (once && emitter.once) {
      emitter.once(event, cb);
    } else {
      emitter.on(event, cb);
    }
  };

  yield* createDiscordListener(register);
  yield* createClanMemberListener(register);

  register(clash, PollingEvents.Error, (error: unknown) => Effect.logError('Clash API Error', error));
});

export const EventHandlerLayer = Layer.effectDiscard(EventHandler);
