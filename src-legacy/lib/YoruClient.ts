import { join } from 'path';
import { container, Logger, LogLevel, SapphireClient } from '@sapphire/framework';
import { logger } from '@vegapunk/logger';
import { chalk, killApp } from '@vegapunk/utilities';
import { v } from '@vegapunk/utilities/strict';
import { GatewayIntentBits, Partials } from 'discord.js';

import { ClashAPI } from './api/ClashAPI';
import { ClientEvents } from './core/constants';
import { OfflineStore } from './stores/OfflineStore';

export const env = v.parse(
  v.pipe(
    v.object({
      DISCORD_TOKEN: v.pipe(v.string(), v.minLength(1)),
      CLASH_EMAIL: v.pipe(v.string(), v.email()),
      CLASH_PASSWORD: v.pipe(v.string(), v.minLength(1)),
    }),
    v.readonly(),
  ),
  process.env,
);

export class YoruClient extends SapphireClient {
  public static readonly isMaintenance: boolean = false;

  public override config: OfflineStore<ConfigContext>;
  public override sessions: OfflineStore<SessionContext>;
  public override loginTimeout: NodeJS.Timeout;

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

    const clientLogger = logger({
      // @ts-expect-error
      level: this.logger.level,
      exception: false,
      rejection: false,
    });
    this.logger.trace = clientLogger.trace.bind(clientLogger);
    this.logger.debug = clientLogger.debug.bind(clientLogger);
    this.logger.info = clientLogger.info.bind(clientLogger);
    this.logger.warn = clientLogger.warn.bind(clientLogger);
    this.logger.error = clientLogger.error.bind(clientLogger);
    this.logger.fatal = clientLogger.fatal.bind(clientLogger);

    this.config = new OfflineStore<ConfigContext>({
      filePath: join(process.cwd(), 'sessions', 'settings.json'),
      init: { prefix: '?', ownerIds: [], clanTags: [] },
      readonly: true,
    });
    this.sessions = new OfflineStore<SessionContext>({
      filePath: join(this.config.dirPath, 'sessions.json'),
      init: { clans: [] },
    });

    this.loginTimeout = setTimeout(() => {
      container.logger.info('YoruClient login timeout.');
      this.destroy();
    }, 60_000).unref();
  }

  public async start(): Promise<void> {
    await Promise.all([this.config.readFile(), this.sessions.readFile()]);
    this.options.defaultPrefix = this.config.data.prefix;

    await this.pollingEvent();
    await super.login(env.DISCORD_TOKEN);
  }

  public override async destroy(): Promise<void> {
    container.logger.info(chalk`{bold.red YoruClient is destroyed.}`);
    super.destroy();
    killApp();
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
