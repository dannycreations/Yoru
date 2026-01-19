import { Util } from 'clashofclans.js';
import { Effect, Option, Ref } from 'effect';

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
    if (Option.isNone(memberOpt)) return;

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
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nError, Player tag not valid!`));
      return;
    }

    if (linkQueue.has(message.author.id)) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nYou must complete previous operation before create new one.`));
      return;
    }

    yield* Ref.update(linkQueueRef, (set) => {
      const next = new Set(set);
      next.add(message.author.id);
      return next;
    });

    yield* Effect.gen(function* () {
      const mentionId = parseMentionOrSnowflake(mention);
      if (!mentionId) {
        yield* Effect.tryPromise(() => message.reply('Please mention a user to link.'));
        return;
      }

      const configStore = yield* ConfigStoreTag;
      const config = yield* configStore.get;
      const isAuthorized = config.ownerIds.includes(message.author.id) || (message.member?.roles.cache.some(isModeratorRole) ?? false);

      if (!isAuthorized) return;

      const player = yield* clash.getPlayer(tag);
      const embed = createPlayerEmbed(player);
      const titleField = `${formatPlayerStats(player)}\n`;

      const accountOpt = yield* accountDatabase.findOne({ tag });
      if (Option.isSome(accountOpt)) {
        const userOpt = yield* userDatabase.findOne({ id: accountOpt.value.userId });
        const user = Option.getOrNull(userOpt);
        const member = message.guild.members.cache.get(user?.ownerId ?? '');

        if (user && user.ownerId === mentionId) {
          yield* linkedTag(message.guild, mentionId, player);
          embed.setDescription(`${titleField}Re-linked to **${member?.user.tag ?? mentionId}**.`);
        } else if (user) {
          if (member) {
            embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`);
          } else {
            yield* userDatabase.update({ ...user, ownerId: mentionId });
            yield* linkedTag(message.guild, mentionId, player);
            const newMember = message.guild.members.cache.get(mentionId);
            embed.setDescription(`${titleField}Owner changed to **${newMember?.user.tag ?? mentionId}**.`);
          }
        }
        yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
        return;
      }

      embed.setDescription(`${titleField}Are you sure you want to link this account?`);
      const msg = yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
      yield* Effect.tryPromise(() => msg.react('✅'));
      yield* Effect.tryPromise(() => msg.react('❎'));

      const filter = (r: MessageReaction, u: DiscordUser) => ['✅', '❎'].includes(r.emoji.name ?? '') && u.id === message.author.id;

      const collected = yield* Effect.tryPromise(() => msg.awaitReactions({ filter, max: 1, time: 60_000 })).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );

      yield* Effect.tryPromise(() => msg.reactions.removeAll());

      if (collected?.first()?.emoji.name === '✅') {
        const userOpt = yield* userDatabase.findOneAndUpdate({ ownerId: mentionId }, { ownerId: mentionId }, { upsert: true });
        if (Option.isSome(userOpt)) {
          yield* accountDatabase.findOneAndUpdate({ tag }, { tag, userId: userOpt.value.id }, { upsert: true });
        }
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
