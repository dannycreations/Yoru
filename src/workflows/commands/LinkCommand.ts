import { Util } from 'clashofclans.js';
import { Array, Effect, Option, Ref } from 'effect';

import { ConfigStoreTag } from '../../core/schemas';
import { AccountDatabaseTag, UserDatabaseTag } from '../../database';
import { createPlayerEmbed, formatPlayerStats } from '../../helpers/ClashHelper';
import { getGuildMember, parseMentionOrSnowflake } from '../../helpers/DiscordHelper';
import { isModeratorRole } from '../../helpers/RoleHelper';
import { ClashClientTag } from '../../services/ClashService';
import { MemberHandlerTag } from '../MemberHandler';

import type { Player } from 'clashofclans.js';
import type { User as DiscordUser, Guild, Message, MessageReaction } from 'discord.js';

const linkedTag = (guild: Guild, ownerId: string, player: Player) =>
  Effect.gen(function* () {
    const memberHandler = yield* MemberHandlerTag;
    const memberOpt = yield* getGuildMember(ownerId, guild);
    if (Option.isNone(memberOpt)) {
      return;
    }

    yield* memberHandler.updatePresence(memberOpt.value, Option.some(player));
  });

const linkQueueRef = Ref.unsafeMake(new Set<string>());

export const linkCommand = (message: Message<true>, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const linkQueue = yield* Ref.get(linkQueueRef);
    const clash = yield* ClashClientTag;
    const accountDatabase = yield* AccountDatabaseTag;
    const userDatabase = yield* UserDatabaseTag;
    const tag = args[0];
    const mention = args[1];

    if (tag === undefined || !Util.isValidTag(tag)) {
      return yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nError, Player tag not valid!`)).pipe(Effect.asVoid);
    }

    if (linkQueue.has(message.author.id)) {
      return yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nYou must complete previous operation before create new one.`)).pipe(
        Effect.asVoid,
      );
    }

    yield* Ref.update(linkQueueRef, (set) => new Set(set).add(message.author.id));

    yield* Effect.gen(function* () {
      const mentionId = parseMentionOrSnowflake(mention);
      if (!mentionId) {
        yield* Effect.tryPromise(() => message.reply('Please mention a user to link.'));
        return;
      }

      const configStore = yield* ConfigStoreTag;
      const config = yield* configStore.get;
      const isAuthorized = Array.contains(config.ownerIds, message.author.id) || (message.member?.roles.cache.some(isModeratorRole) ?? false);
      if (!isAuthorized) {
        return;
      }

      const player = yield* clash.getPlayer(tag);
      const embed = yield* createPlayerEmbed(player);
      const titleField = `${yield* formatPlayerStats(player)}\n`;

      const accountOpt = yield* accountDatabase.findOne({ tag });
      if (Option.isSome(accountOpt)) {
        const userOpt = yield* userDatabase.findOne({ id: accountOpt.value.userId });
        const user = Option.getOrUndefined(userOpt);
        const member = message.guild.members.cache.get(user?.ownerId ?? '');

        if (user && user.ownerId === mentionId) {
          yield* linkedTag(message.guild, mentionId, player);
          embed.setDescription(`${titleField}Re-linked to **${member?.user.tag ?? mentionId}**.`);
        } else if (user && member) {
          embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`);
        } else if (user) {
          yield* userDatabase.update({ ...user, ownerId: mentionId });
          yield* linkedTag(message.guild, mentionId, player);
          const newMember = message.guild.members.cache.get(mentionId);
          embed.setDescription(`${titleField}Owner changed to **${newMember?.user.tag ?? mentionId}**.`);
        }

        yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
        return;
      }

      embed.setDescription(`${titleField}Are you sure you want to link this account?`);
      const msg = yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
      yield* Effect.tryPromise(() => msg.react('✅'));
      yield* Effect.tryPromise(() => msg.react('❎'));

      const filter = (r: MessageReaction, u: DiscordUser) => ['✅', '❎'].includes(r.emoji.name ?? '') && u.id === message.author.id;
      const collected = yield* Effect.tryPromise(() => msg.awaitReactions({ filter, max: 1, time: 60_000 })).pipe(Effect.orElseSucceed(() => null));

      yield* Effect.tryPromise(() => msg.reactions.removeAll());

      if (collected?.first()?.emoji.name === '✅') {
        const userOpt = yield* userDatabase.findOneAndUpdate({ ownerId: mentionId }, { ownerId: mentionId }, { upsert: true });
        yield* Option.match(userOpt, {
          onNone: () => Effect.void,
          onSome: (user) => accountDatabase.findOneAndUpdate({ tag }, { tag, userId: user.id }, { upsert: true }),
        });
        yield* linkedTag(message.guild, mentionId, player);
        const member = message.guild.members.cache.get(mentionId);
        embed.setDescription(`${titleField}Linked to **${member?.user.tag ?? mentionId}**.`);
      } else {
        const description =
          (collected?.size ?? 0) > 0 ? `${titleField}Operation canceled.` : `${titleField}No answer after 60 seconds, operation canceled.`;
        embed.setDescription(description);
      }

      yield* Effect.tryPromise(() => msg.edit({ embeds: [embed] }));
    }).pipe(
      Effect.ensuring(
        Ref.update(linkQueueRef, (set) => {
          const next = new Set(set);
          next.delete(message.author.id);
          return next;
        }),
      ),
      Effect.asVoid,
    );
  }).pipe(Effect.asVoid);
