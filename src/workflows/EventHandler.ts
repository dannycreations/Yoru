import { PollingEvents } from 'clashofclans.js';
import { Effect, Layer, Runtime } from 'effect';

import { ClashTag } from '../services/ClashService';
import { createClanMemberListener } from './listeners/ClanMemberListener';
import { createDiscordListener } from './listeners/DiscordListener';

export const EventHandler = Effect.gen(function* () {
  const { client } = yield* ClashTag;
  const runtime = yield* Effect.runtime();

  const register = (
    emitter: { on: (event: string, cb: (...args: any[]) => void) => void; once?: (event: string, cb: (...args: any[]) => void) => void },
    event: string,
    handler: (...args: any[]) => Effect.Effect<void, unknown, never>,
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
  yield* createClanMemberListener();

  register(client, PollingEvents.Error, (error: unknown) => Effect.logError('Clash API Error', error));
});

export const EventHandlerLayer = Layer.effectDiscard(EventHandler);
