import { Listener } from '@sapphire/framework';

export class UserListener extends Listener {
  public constructor(context: Listener.LoaderContext) {
    super(context, { emitter: process, event: 'uncaughtException' });
  }

  public run(error: Error): void {
    if ('context' in error && typeof error.context === 'object') {
      const { context } = error as ErrorContext;
      if (context.error.code === 'ENOTFOUND') return;
    }
    this.container.logger.fatal(error, 'UncaughtException.');
  }
}

interface ErrorContext extends Error {
  readonly context: {
    readonly error: {
      readonly errno: number;
      readonly code: string;
      readonly syscall: string;
      readonly hostname: string;
    };
  };
}
