import { Listener } from '@sapphire/framework';

export class UserListener extends Listener {
  public constructor(context: Listener.LoaderContext) {
    super(context, { emitter: process, event: 'unhandledRejection' });
  }

  public run(error: Error): void {
    this.container.logger.fatal(error, 'UnhandledRejection.');
  }
}
