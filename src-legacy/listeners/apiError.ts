import { Listener } from '@sapphire/framework';
import { send } from '@sapphire/plugin-editable-commands';
import { HTTPError } from 'clashofclans.js';

import { ClashAPI } from '../lib/api/ClashAPI';
import { ClientEvents } from '../lib/core/constants';

import type { Message } from 'discord.js';

export class UserListener extends Listener {
  public constructor(context: Listener.LoaderContext) {
    super(context, { emitter: ClashAPI.Instance, event: ClientEvents.ApiError });
  }

  public async run(message: Message<true>, error: unknown): Promise<void> {
    let field = `> ${message.content}\nUnhandled Rejection, please contact owner!`;
    if (error instanceof HTTPError) {
      field = `> ${message.content}\n${error.message}`;
      if (error.reason === 'notFound' && error.path.includes('/players/')) {
        field = `> ${message.content}\nError, Player tag not found!`;
      }
    } else {
      this.container.logger.error(error);
    }
    if (!message) {
      return;
    }

    await send(message, field);
  }
}
