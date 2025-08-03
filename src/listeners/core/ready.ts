import { Listener } from '@sapphire/framework';
import { ActivityType, Client } from 'discord.js';

export class UserListener extends Listener<'ready'> {
  public constructor(context: Listener.LoaderContext) {
    super(context, { event: 'ready' });
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
