import { Context, Data, Effect, Layer, Schema } from 'effect';

import { Store, StoreLayer } from '../services/StoreService';

export class EnvError extends Data.TaggedError('EnvError')<{
  readonly message: string;
}> {}

export const EnvSchema = Schema.Struct({
  NODE_ENV: Schema.optional(Schema.Literal('development', 'production', 'test')).pipe(
    Schema.withDefaults({
      constructor: () => 'development' as const,
      decoding: () => 'development' as const,
    }),
  ),
  DISCORD_TOKEN: Schema.NonEmptyString,
  CLASH_EMAIL: Schema.NonEmptyString,
  CLASH_PASSWORD: Schema.NonEmptyString,
});

export type Env = Schema.Schema.Type<typeof EnvSchema>;

export class EnvTag extends Context.Tag('@schema/EnvLayer')<EnvTag, Env>() {}

export const EnvLayer = Layer.effect(
  EnvTag,
  Effect.gen(function* () {
    return yield* Schema.decodeUnknown(EnvSchema)(process.env).pipe(
      Effect.mapError((error) => new EnvError({ message: `Invalid environment variables: ${error.message}` })),
    );
  }),
);

export const EmojiSchema = Schema.Struct({
  thumbnail: Schema.String,
  level: Schema.String,
  hashtag: Schema.String,
  trophies: Schema.String,
  attackwin: Schema.String,
  noleague: Schema.String,
  isclan: Schema.Struct({ true: Schema.String, false: Schema.String }),
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

export type Emoji = Schema.Schema.Type<typeof EmojiSchema>;

export const ClanSchema = Schema.Struct({
  tag: Schema.String,
  name: Schema.String,
  members: Schema.Array(Schema.Any),
});

export type ClanData = Schema.Schema.Type<typeof ClanSchema>;

export const ConfigSchema = Schema.Struct({
  prefix: Schema.String,
  ownerIds: Schema.Array(Schema.String),
  clanTags: Schema.Array(Schema.String),
});

export type Config = Schema.Schema.Type<typeof ConfigSchema>;

export class ConfigStoreTag extends Context.Tag('@schema/ConfigStoreLayer')<ConfigStoreTag, Store<Config>>() {}

export const ConfigStoreLayer = StoreLayer(ConfigStoreTag, 'sessions/settings.json', ConfigSchema, { prefix: '?', ownerIds: [], clanTags: [] }, 5000);

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

export type Session = Schema.Schema.Type<typeof SessionSchema>;

export class SessionStoreTag extends Context.Tag('@schema/SessionStoreLayer')<SessionStoreTag, Store<Session>>() {}

export const SessionStoreLayer = StoreLayer(SessionStoreTag, 'sessions/sessions.json', SessionSchema, { clans: [], leavers: [] }, 5000);
