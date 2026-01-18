import { PollingEvents } from 'clashofclans.js';
import { Effect, Layer } from 'effect';

import { ClashTag } from '../services/ClashService';
import { makeBridge } from '../structures/RuntimeClient';
import { createClanMemberListener } from './listeners/ClanMemberListener';
import { createDiscordListener } from './listeners/DiscordListener';

export const EventHandler = Effect.gen(function* () {
  const { client } = yield* ClashTag;
  const bridge = yield* makeBridge;

  const register = (
    emitter: { on: (event: string, cb: (...args: any[]) => void) => void; once?: (event: string, cb: (...args: any[]) => void) => void },
    event: string,
    handler: (...args: any[]) => Effect.Effect<void, unknown, never>,
    once = false,
  ) => {
    const cb = (...args: any[]) => bridge.fork(handler(...args), { name: event });

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
