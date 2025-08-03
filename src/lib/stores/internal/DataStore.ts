import { RequiredExcept } from '@vegapunk/utilities';
import { defaultsDeep } from '@vegapunk/utilities/common';

export abstract class DataStore<T extends object> {
  public static readonly MIN_DELAY: number = 1000;
  public static readonly MAX_DELAY: number = 2147483647;

  public readonly options: RequiredExcept<DataStoreOptions<T>, 'watch'>;
  public readonly data: DataStoreInternalData<T>;

  public constructor(options: DataStoreOptions<T>) {
    this.options = {
      ...options,
      init: options.init ?? ({} as T),
      delay: options.delay ?? DataStore.MIN_DELAY,
      watch: options.watch ?? undefined,
      readonly: options.readonly ?? false,
    };

    this.data = { ...(this.options.init as T), __updatedAt: 0 };
    this.previousData = JSON.stringify(this.data);

    this.setDelay(this.options.delay);
    if (this.options.watch) {
      this.watch();
    }
  }

  public abstract readonly dir: string;
  protected abstract _init(): Promise<void>;
  protected abstract _readFile(): Promise<T | null>;
  protected abstract _writeFile(): Promise<void>;

  public setDelay(delayMs: number = DataStore.MIN_DELAY): void {
    this.delayMs = Math.min(Math.max(Math.trunc(delayMs), DataStore.MIN_DELAY), DataStore.MAX_DELAY);
  }

  public async readFile(): Promise<void> {
    await this.ensureInit();

    const fileData = (await this._readFile()) ?? ({} as T);
    Object.assign(this.data, defaultsDeep({}, fileData, this.data, this.options.init));
  }

  public async writeFile(data: Partial<T> = this.data, force: boolean = false): Promise<void> {
    await this.ensureInit();

    Object.assign(this.data, defaultsDeep({}, data, this.data));
    if (this.options.readonly && !force) {
      return;
    }

    const currentTimeMs = Date.now();
    const delayNotElapsed = this.data.__updatedAt + this.delayMs > currentTimeMs;
    if (!force && delayNotElapsed) {
      return;
    }

    const currentData = JSON.stringify(this.data);
    const isDataUnchanged = currentData === this.previousData;
    if (!force && isDataUnchanged) {
      return;
    }

    this.data.__updatedAt = currentTimeMs;
    await this._writeFile();
    this.previousData = JSON.stringify(this.data);
  }

  public clear(force: boolean = false): void {
    if (this.options.readonly && !force) {
      return;
    }

    Object.assign(this, {
      data: {
        ...this.options.init,
        __updatedAt: 0,
      },
    });
    this.previousData = JSON.stringify(this.data);
  }

  private watchTimeoutId?: NodeJS.Timeout;
  private watch(): void {
    if (this.watchTimeoutId) {
      clearTimeout(this.watchTimeoutId);
      this.watchTimeoutId = undefined;
    }
    if (!this.options.watch) {
      return;
    }

    this.watchTimeoutId = setTimeout(async () => {
      if (!this.options.watch) {
        return;
      }

      try {
        const watchData = await this.options.watch();
        await this.writeFile(watchData);
      } finally {
        this.watch();
      }
    }, this.delayMs).unref();
  }

  private initPromise?: Promise<void>;
  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          await this._init();
        } catch (error) {
          this.initPromise = undefined;
          throw error;
        }
      })();
    }
    return this.initPromise;
  }

  private previousData: string;
  private delayMs: number = DataStore.MIN_DELAY;
}

type DataStoreInternalData<T extends object> = T & {
  __updatedAt: number;
};

export interface DataStoreOptions<T extends object> {
  readonly init?: T;
  readonly delay?: number;
  readonly readonly?: boolean;
  readonly watch?: () => Promise<T>;
}
