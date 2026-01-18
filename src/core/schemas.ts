import { Config, Context, Data, Effect, Layer, Schema } from 'effect';

import { StoreClientLayer } from '../structures/StoreClient';

import type { StoreClient } from '../structures/StoreClient';

export class EnvError extends Data.TaggedError('EnvError')<{
  readonly message: string;
}> {}

export const EnvSchema = Schema.Struct({
  NODE_ENV: Schema.Literal('development', 'production', 'test'),
  DISCORD_TOKEN: Schema.NonEmptyString,
  CLASH_EMAIL: Schema.NonEmptyString,
  CLASH_PASSWORD: Schema.NonEmptyString,
});

export interface Env extends Schema.Schema.Type<typeof EnvSchema> {}

export class EnvTag extends Context.Tag('@core/Env')<EnvTag, Env>() {}

export const EnvLayer = Layer.effect(
  EnvTag,
  Config.all({
    NODE_ENV: Config.string('NODE_ENV').pipe(Config.withDefault('development')),
    DISCORD_TOKEN: Config.string('DISCORD_TOKEN'),
    CLASH_EMAIL: Config.string('CLASH_EMAIL'),
    CLASH_PASSWORD: Config.string('CLASH_PASSWORD'),
  }).pipe(
    Effect.flatMap((raw) => Schema.decodeUnknown(EnvSchema)(raw)),
    Effect.mapError((error) => new EnvError({ message: `Invalid environment variables: ${String(error)}` })),
  ),
);

export const EmojiSchema = Schema.Struct({
  thumbnail: Schema.String,
  level: Schema.String,
  hashtag: Schema.String,
  trophies: Schema.String,
  attackwin: Schema.String,
  noleague: Schema.String,
  isclan: Schema.Struct({
    true: Schema.String,
    false: Schema.String,
  }),
  stars: Schema.Array(Schema.String),
  townhalls: Schema.Array(Schema.String),
  troops: Schema.Struct({
    normal: Schema.Record({ key: Schema.String, value: Schema.String }),
    dark: Schema.Record({ key: Schema.String, value: Schema.String }),
    super: Schema.Record({ key: Schema.String, value: Schema.String }),
    siege: Schema.Record({ key: Schema.String, value: Schema.String }),
    pets: Schema.Record({ key: Schema.String, value: Schema.String }),
  }),
  spells: Schema.Struct({
    normal: Schema.Record({ key: Schema.String, value: Schema.String }),
    dark: Schema.Record({ key: Schema.String, value: Schema.String }),
  }),
  heroes: Schema.Record({ key: Schema.String, value: Schema.String }),
});

export interface Emoji extends Schema.Schema.Type<typeof EmojiSchema> {}

export const ClanSchema = Schema.Struct({
  tag: Schema.String,
  name: Schema.String,
  members: Schema.Array(
    Schema.Struct({
      tag: Schema.String,
      name: Schema.String,
    }),
  ),
});

export interface ClanData extends Schema.Schema.Type<typeof ClanSchema> {}

export const ConfigSchema = Schema.Struct({
  prefix: Schema.String,
  ownerIds: Schema.Array(Schema.String),
  clanTags: Schema.Array(Schema.String),
});

export interface Config extends Schema.Schema.Type<typeof ConfigSchema> {}

export class ConfigStoreTag extends Context.Tag('@core/ConfigStore')<ConfigStoreTag, StoreClient<Config>>() {}

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

export class SessionStoreTag extends Context.Tag('@core/SessionStore')<SessionStoreTag, StoreClient<Session>>() {}

export const SessionStoreLayer = StoreClientLayer(SessionStoreTag, 'sessions/sessions.json', SessionSchema, { clans: [], leavers: [] }, 5000);
