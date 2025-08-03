import { join } from 'path';
import { container, Logger, LogLevel, SapphireClient } from '@sapphire/framework';
import { logger } from '@vegapunk/logger';
import { chalk } from '@vegapunk/utilities';
import { z } from '@vegapunk/utilities/strict';
import { GatewayIntentBits, Partials } from 'discord.js';

import { ClashAPI } from './api/ClashAPI';
import { ClientEvents } from './contants/enum';
import { OfflineStore } from './stores/OfflineStore';

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  CLASH_EMAIL: z.string().email(),
  CLASH_PASSWORD: z.string().min(1),
});

export const env = EnvSchema.readonly().parse({
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CLASH_EMAIL: process.env.CLASH_EMAIL,
  CLASH_PASSWORD: process.env.CLASH_PASSWORD,
});

export class YoruClient extends SapphireClient {
  public static readonly isMaintenance: boolean = false;

  public override config: OfflineStore<ConfigContext>;
  public override sessions: OfflineStore<SessionContext>;
  public override loginTimeout: NodeJS.Timeout = setTimeout(() => {
    container.logger.info('YoruClient login timeout.');
    this.destroy();
  }, 60_000).unref();

  public constructor() {
    super({
      typing: true,
      shards: 'auto',
      disableMentionPrefix: true,
      caseInsensitiveCommands: true,
      caseInsensitivePrefixes: true,
      loadDefaultErrorListeners: true,
      loadMessageCommandListeners: true,
      logger: new Logger(LogLevel.Debug),
      partials: [...Object.values(Partials)] as Partials[],
      intents: [...Object.values(GatewayIntentBits)] as GatewayIntentBits[],
    });

    const _logger = logger({
      // @ts-expect-error
      level: this.logger.level,
      exception: false,
      rejection: false,
    });
    this.logger.trace = _logger.trace.bind(_logger);
    this.logger.debug = _logger.debug.bind(_logger);
    this.logger.info = _logger.info.bind(_logger);
    this.logger.warn = _logger.warn.bind(_logger);
    this.logger.error = _logger.error.bind(_logger);
    this.logger.fatal = _logger.fatal.bind(_logger);

    this.config = new OfflineStore<ConfigContext>({
      path: join(process.cwd(), 'sessions', 'settings.json'),
      init: { prefix: '?', ownerIds: [], clanTags: [] },
      readonly: true,
    });
    this.sessions = new OfflineStore<SessionContext>({
      path: join(this.config.dir, 'sessions.json'),
      init: { clans: [] },
    });
  }

  public async start(): Promise<void> {
    await Promise.all([this.config.readFile(), this.sessions.readFile()]);
    this.options.defaultPrefix = this.config.data.prefix;

    await this.pollingEvent();
    await super.login(env.DISCORD_TOKEN);
  }

  public override async destroy(): Promise<void> {
    container.logger.info(chalk`{bold.red YoruClient is destroyed.}`);
    await super.destroy();
    process.exit(1);
  }

  private async pollingEvent() {
    ClashAPI.Instance.addClans(this.config.data.clanTags);
    ClashAPI.Instance.setClanEvent({ name: ClientEvents.ClanMember, filter: Boolean });

    await ClashAPI.Instance.init();
  }
}

declare module 'discord.js' {
  interface Client {
    loginTimeout?: NodeJS.Timeout;
    readonly config: OfflineStore<ConfigContext>;
    readonly sessions: OfflineStore<SessionContext>;
  }
}

export interface ConfigContext {
  readonly prefix: string;
  readonly ownerIds: string[];
  readonly clanTags: string[];
}

export interface SessionContext {
  readonly clans: Array<{ name: string; tag: string }>;
}
