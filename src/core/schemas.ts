import { Context, Effect, Layer, Schema } from 'effect';

import { Store, StoreService } from '../services/StoreService';

/**
 * Schema for environment variables.
 */
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

/**
 * Context tag for the Env service.
 */
export class EnvTag extends Context.Tag('@core/EnvTag')<EnvTag, Env>() {}

/**
 * Layer that decodes environment variables into the EnvTag.
 */
export const EnvLayer = Layer.effect(
  EnvTag,
  Effect.gen(function* () {
    const decode = Schema.decodeUnknown(EnvSchema);
    return yield* decode(process.env).pipe(Effect.mapError((error) => new Error(`Invalid environment variables: ${error.message}`)));
  }),
);

/**
 * Schema for emoji data structure.
 */
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

/**
 * Schema for clan data.
 */
export const ClanSchema = Schema.Struct({
  tag: Schema.String,
  name: Schema.String,
  members: Schema.Array(Schema.Any),
});

export type ClanData = Schema.Schema.Type<typeof ClanSchema>;

/**
 * Schema for bot configuration.
 */
export const ConfigSchema = Schema.Struct({
  prefix: Schema.String,
  ownerIds: Schema.Array(Schema.String),
  clanTags: Schema.Array(Schema.String),
});

export type Config = Schema.Schema.Type<typeof ConfigSchema>;

/**
 * Context tag for the Config store.
 */
export class ConfigStore extends Context.Tag('@core/ConfigStore')<ConfigStore, Store<Config>>() {}

/**
 * Layer providing the ConfigStore using local JSON file persistence.
 */
export const ConfigStoreLayer = StoreService(ConfigStore, 'sessions/settings.json', ConfigSchema, { prefix: '?', ownerIds: [], clanTags: [] }, 5000);

/**
 * Schema for session data.
 */
export const SessionSchema = Schema.Struct({
  clans: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      tag: Schema.String,
    }),
  ),
});

export type Session = Schema.Schema.Type<typeof SessionSchema>;

/**
 * Context tag for the Session store.
 */
export class SessionStore extends Context.Tag('@core/SessionStore')<SessionStore, Store<Session>>() {}

/**
 * Layer providing the SessionStore using local JSON file persistence.
 */
export const SessionStoreLayer = StoreService(SessionStore, 'sessions/sessions.json', SessionSchema, { clans: [] }, 5000);
