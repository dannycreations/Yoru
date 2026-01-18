import { Effect } from 'effect';

import { DiscordHandlerTag } from '../DiscordHandler';

import type { Message } from 'discord.js';

export const pingCommand = (message: Message<true>) =>
  Effect.gen(function* () {
    const { client: discord } = yield* DiscordHandlerTag;
    const msg = yield* Effect.tryPromise(() => message.reply('ping?'));
    const botLatency = Math.round(discord.ws.ping);
    const apiLatency = msg.createdTimestamp - message.createdTimestamp;

    const latencyReport = `Pong! BOT Latency ${botLatency}ms. API Latency ${apiLatency}ms.`;
    yield* Effect.tryPromise(() => msg.edit(latencyReport));
  }).pipe(Effect.asVoid);
