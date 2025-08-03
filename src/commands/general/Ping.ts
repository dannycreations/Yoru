import { Command } from '@sapphire/framework';
import { Message } from 'discord.js';

export class UserCommand extends Command {
  public constructor(context: Command.LoaderContext) {
    super(context, { aliases: ['p'] });
  }

  public override async messageRun(message: Message<true>): Promise<void> {
    const msg = await message.reply('ping?');
    const botLatency = Math.round(this.container.client.ws.ping);
    const apiLatency = msg.createdTimestamp - message.createdTimestamp;
    await msg.edit(`Pong! BOT Latency ${botLatency}ms. API Latency ${apiLatency}ms.`);
  }
}
