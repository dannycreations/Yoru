import { Listener } from '@sapphire/framework';
import { send } from '@sapphire/plugin-editable-commands';

import { YoruClient } from '../../lib/YoruClient';

import type { Message } from 'discord.js';

export class UserListener extends Listener<'messageCreate'> {
  public constructor(context: Listener.LoaderContext) {
    super(context, { event: 'messageCreate' });
  }

  public async run(message: Message<true>): Promise<void> {
    if (message.webhookId !== null || message.system || message.author.bot) {
      return;
    }

    const { config } = this.container.client;

    this.container.logger.info(`${message.author.tag}: ${message.content}`);
    if (YoruClient.isMaintenance && !config.data.ownerIds.includes(message.author.id)) {
      await send(message, '⚠️ Under Maintenance!');
    }
  }
}
