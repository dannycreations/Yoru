import { Listener } from '@sapphire/framework';
import { ActivityType } from 'discord.js';

import type { Client } from 'discord.js';

export class UserListener extends Listener<'clientReady'> {
  public constructor(context: Listener.LoaderContext) {
    super(context, { event: 'clientReady' });
  }

  public run(client: Client<true>): void {
    if (typeof client.loginTimeout !== 'undefined') {
      clearTimeout(client.loginTimeout);
      client.loginTimeout = undefined;

      const text = [
        'Bot has started,',
        `${client.users.cache.size} users,`,
        `${client.channels.cache.size} channels,`,
        `${client.guilds.cache.size} guilds.`,
      ];
      this.container.logger.info(text.join(' '));
    }

    client.user.setPresence({
      status: 'idle',
      activities: [
        {
          name: 'Clash of Clans',
          type: ActivityType.Playing,
        },
      ],
    });
  }
}
