import { Config, Context, Data, Effect, Layer, Schema } from 'effect';

import { StoreClientLayer } from '../structures/StoreClient.js';

import type { StoreClient } from '../structures/StoreClient.js';

export class EnvError extends Data.TaggedError('EnvError')<{
  readonly message: string;
}> {}

export const EnvSchema = Schema.Struct({
  NODE_ENV: Schema.Literals(['development', 'production', 'test']),
  DISCORD_TOKEN: Schema.NonEmptyString,
  CLASH_EMAIL: Schema.NonEmptyString,
  CLASH_PASSWORD: Schema.NonEmptyString,
});

export interface Env extends Schema.Schema.Type<typeof EnvSchema> {}

export class EnvTag extends Context.Service<EnvTag, Env>()('@core/Env') {}

export const EnvLayer = Layer.effect(
  EnvTag,
  Config.all({
    NODE_ENV: Config.String('NODE_ENV').pipe(Config.withDefault('development')),
    DISCORD_TOKEN: Config.String('DISCORD_TOKEN'),
    CLASH_EMAIL: Config.String('CLASH_EMAIL'),
    CLASH_PASSWORD: Config.String('CLASH_PASSWORD'),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(EnvSchema)),
    Effect.mapError((error) => new EnvError({ message: `Invalid environment variables: ${error}` })),
  ),
);

export const ConfigSchema = Schema.Struct({
  prefix: Schema.String,
  ownerIds: Schema.Array(Schema.String),
  clanTags: Schema.Array(Schema.String),
});

export interface Config extends Schema.Schema.Type<typeof ConfigSchema> {}

export class ConfigStoreTag extends Context.Service<ConfigStoreTag, StoreClient<Config>>()('@core/ConfigStore') {}

export const ConfigStoreLayer = StoreClientLayer(
  ConfigStoreTag,
  'sessions/settings.json',
  ConfigSchema,
  { prefix: '?', ownerIds: [], clanTags: [] },
  5000,
);

export const SessionSchema = Schema.Struct({
  clans: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        tag: Schema.String,
      }),
    ),
  ),
  leavers: Schema.optional(Schema.Array(Schema.String)),
});

export interface Session extends Schema.Schema.Type<typeof SessionSchema> {}

export class SessionStoreTag extends Context.Service<SessionStoreTag, StoreClient<Session>>()('@core/SessionStore') {}

export const SessionStoreLayer = StoreClientLayer(SessionStoreTag, 'sessions/sessions.json', SessionSchema, { clans: [], leavers: [] }, 5000);
