import { Util } from 'clashofclans.js';
import { Array, Effect, Option, Ref } from 'effect';

import { ConfigStoreTag } from '../../core/schemas.js';
import { AccountDatabaseTag, UserDatabaseTag } from '../../database/index.js';
import { userTable } from '../../database/schema.js';
import { createPlayerEmbed, formatPlayerStats } from '../../helpers/ClashHelper.js';
import { getGuildMember, parseMentionOrSnowflake, replyMessage } from '../../helpers/DiscordHelper.js';
import { isModeratorRole } from '../../helpers/RoleHelper.js';
import { ClashClientTag } from '../../services/ClashService.js';
import { MemberHandlerTag } from '../MemberHandler.js';

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
      return yield* replyMessage(message, `> ${message.content}\nError, Player tag not valid!`);
    }

    if (linkQueue.has(message.author.id)) {
      return yield* replyMessage(message, `> ${message.content}\nYou must complete previous operation before create new one.`);
    }

    yield* Ref.update(linkQueueRef, (set) => new Set(set).add(message.author.id));

    yield* Effect.gen(function* () {
      const mentionId = parseMentionOrSnowflake(mention);
      if (!mentionId) {
        yield* replyMessage(message, 'Please mention a user to link.');
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

      const rowOpt = yield* accountDatabase.findOne(
        { tag },
        { joins: [{ table: userTable, on: { userId: 'id' }, type: 'inner' }], select: { userId: 1, ownerId: 1 } },
      );
      if (Option.isSome(rowOpt)) {
        const { userId, ownerId } = rowOpt.value;
        const member = message.guild.members.cache.get(ownerId);

        if (ownerId === mentionId) {
          yield* linkedTag(message.guild, mentionId, player);
          embed.setDescription(`${titleField}Re-linked to **${member?.user.tag ?? mentionId}**.`);
        } else if (member) {
          embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`);
        } else {
          yield* userDatabase.update({ id: userId, ownerId: mentionId });
          yield* linkedTag(message.guild, mentionId, player);
          const newMember = message.guild.members.cache.get(mentionId);
          embed.setDescription(`${titleField}Owner changed to **${newMember?.user.tag ?? mentionId}**.`);
        }

        yield* replyMessage(message, { embeds: [embed] });
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
