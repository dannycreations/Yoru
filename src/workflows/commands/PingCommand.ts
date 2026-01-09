import { Effect } from 'effect';

import { DiscordClientTag } from '../DiscordHandler';

import type { Message } from 'discord.js';

/**
 * Handles the ping command.
 * Replies with the bot's latency and the API latency.
 */
export const pingCommand = (message: Message<true>) =>
  Effect.gen(function* () {
    const { client: discord } = yield* DiscordClientTag;
    const msg = yield* Effect.tryPromise(() => message.reply('ping?'));
    const botLatency = Math.round(discord.ws.ping);
    const apiLatency = msg.createdTimestamp - message.createdTimestamp;

    // Update the message with calculated latencies.
    yield* Effect.tryPromise(() => msg.edit(`Pong! BOT Latency ${botLatency}ms. API Latency ${apiLatency}ms.`));
  });
