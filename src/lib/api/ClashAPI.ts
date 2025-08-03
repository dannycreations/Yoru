import { ERROR_CODES, ERROR_STATUS_CODES, waitForConnection } from '@vegapunk/request';
import { isErrorLike } from '@vegapunk/utilities/result';
import { sleep } from '@vegapunk/utilities/sleep';
import { HTTPError, PollingClient, RequestOptions } from 'clashofclans.js';

import { env, YoruClient } from '../YoruClient';

const ERROR_CODES_UND: readonly string[] = [...ERROR_CODES, 'UND_ERR_CONNECT_TIMEOUT'];

export class ClashAPI extends PollingClient {
  public static readonly Instance: ClashAPI = new ClashAPI();

  public constructor() {
    super({ pollingInterval: 60_000 });

    this.rest.requestHandler['reValidateKeys'] = () => Promise.resolve();

    const getIpOrig = this.rest.requestHandler['getIp'].bind(this.rest.requestHandler);
    this.rest.requestHandler['getIp'] = (token: string) => {
      const _ipFromError = this.ipFromError;
      if (typeof _ipFromError === 'string') {
        this.ipFromError = undefined;
        return _ipFromError;
      }
      return getIpOrig(token);
    };

    const requestOrig = this.rest.requestHandler.request.bind(this.rest.requestHandler);
    this.rest.requestHandler.request = async <T>(path: string, options: RequestOptions = {}) => {
      try {
        const res = await requestOrig<T>(path, options);
        this.requestState = 0;
        return res;
      } catch (error) {
        if (isErrorLike(error)) {
          if (this.requestState > 2) {
            this.requestState = 2;
            error.message = 'There is a problem with the API, please check back later!';
            throw error;
          }

          if (ERROR_CODES_UND.includes(error.code)) {
            this.requestState = 0;
            await waitForConnection();
            return this.rest.requestHandler.request(path, options);
          } else if (error instanceof HTTPError) {
            if (error.status === 503) {
              this.requestState = 0;
              error.message = 'Service is temporarily unavailable because of maintenance!';
              throw error;
            } else if (error.status === 403) {
              if (error.reason === 'accessDenied.invalidIp') {
                this.rest.requestHandler['keys'].shift();
                this.ipFromError = error.message.match(/(\d{1,3}\.){3}\d+/)![0];
              }

              await this.rest.login({
                email: env.CLASH_EMAIL,
                password: env.CLASH_PASSWORD,
                keyName: YoruClient.name,
                keyCount: 1,
              });

              this.requestState++;
              return this.rest.requestHandler.request(path, options);
            } else if (ERROR_STATUS_CODES.includes(error.status)) {
              await sleep(10_000);
              this.requestState = 0;
              return this.rest.requestHandler.request(path, options);
            }
          } else if (error instanceof SyntaxError) {
            if (error.message.includes('not valid JSON')) {
              await sleep(10_000);
              return this.rest.requestHandler.request(path, options);
            }
          }

          error.stack = undefined;
          error.message = `${ClashAPI.name}: ${error.message}`;
        }
        throw error;
      }
    };
  }

  private ipFromError?: string;
  private requestState: number = 0;
}
