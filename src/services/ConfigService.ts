import { Context, Schema } from 'effect';

import { Store, StoreService } from './StoreService';

export const ConfigSchema = Schema.Struct({
  prefix: Schema.String,
  ownerIds: Schema.Array(Schema.String),
  clanTags: Schema.Array(Schema.String),
});

export type Config = Schema.Schema.Type<typeof ConfigSchema>;

export class ConfigStore extends Context.Tag('@services/ConfigStore')<ConfigStore, Store<Config>>() {}

export const ConfigStoreLayer = StoreService(
  ConfigStore as unknown as Context.Tag<Store<Config>, Store<Config>>,
  'sessions/settings.json',
  ConfigSchema,
  { prefix: '?', ownerIds: [], clanTags: [] },
  5000,
);

export const SessionSchema = Schema.Struct({
  clans: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      tag: Schema.String,
    }),
  ),
});

export type Session = Schema.Schema.Type<typeof SessionSchema>;

export class SessionStore extends Context.Tag('@services/SessionStore')<SessionStore, Store<Session>>() {}

export const SessionStoreLayer = StoreService(
  SessionStore as unknown as Context.Tag<Store<Session>, Store<Session>>,
  'sessions/sessions.json',
  SessionSchema,
  { clans: [] },
  5000,
);
