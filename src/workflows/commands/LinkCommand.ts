import { Util } from 'clashofclans.js';
import { Effect, Option } from 'effect';

import { ConfigStoreTag } from '../../core/schemas';
import { AccountAdapter, UserAdapter } from '../../database';
import { MemberManagerTag } from '../../domain/MemberManager';
import { createPlayerEmbed, formatPlayerStats } from '../../helpers/clash.helper';
import { getGuildMember, parseMentionOrSnowflake } from '../../helpers/discord.helper';
import { isModeratorRole } from '../../helpers/role.helper';
import { ClashTag } from '../../services/ClashService';

import type { Player } from 'clashofclans.js';
import type { User as DiscordUser, Guild, Message, MessageReaction } from 'discord.js';

// Localizing the presence update logic within a helper that utilizes robust member resolution ensures that player roles and nicknames are consistently synchronized upon linking.
const linkedTag = (guild: Guild, ownerId: string, player: Player) =>
  Effect.gen(function* () {
    const memberManager = yield* MemberManagerTag;
    const memberOpt = yield* getGuildMember(ownerId, guild);
    if (Option.isNone(memberOpt)) return;

    yield* memberManager.updatePresence(memberOpt.value, player);
  });

const linkQueue = new Set<string>();

export const linkCommand = (message: Message<true>, args: string[]) =>
  Effect.gen(function* () {
    const clash = yield* ClashTag;
    const tag = args[0];
    const mention = args[1];

    // Player tag formats are validated using the clashofclans.js utility to ensure data integrity.
    if (tag === undefined || !Util.isValidTag(tag)) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nError, Player tag not valid!`));
      return;
    }

    // Concurrent link operations from the same author are prevented to avoid race conditions during the linking process.
    if (linkQueue.has(message.author.id)) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nYou must complete previous operation before create new one.`));
      return;
    }
    linkQueue.add(message.author.id);

    yield* Effect.gen(function* () {
      const mentionId = parseMentionOrSnowflake(mention);
      if (!mentionId) {
        yield* Effect.tryPromise(() => message.reply('Please mention a user to link.'));
        return;
      }

      const configStore = yield* ConfigStoreTag;
      const config = yield* configStore.get;
      // Authorization checks restrict tag linking capabilities to owners and moderators.
      const isAuthorized = config.ownerIds.includes(message.author.id) || (message.member?.roles.cache.some(isModeratorRole) ?? false);
      if (!isAuthorized) return;

      // Player data is fetched from the API to populate the confirmation embed with accurate information.
      const player = yield* clash.getPlayer(tag);
      // The player embed is initialized with default formatting, including clan footers, through a centralized helper.
      const embed = createPlayerEmbed(player);

      const titleField = `${formatPlayerStats(player)}\n`;

      // Database lookups verify whether a tag is already associated with an existing account.
      const account = yield* AccountAdapter.findOne({ tag });
      if (account) {
        const user = yield* UserAdapter.findOne({ id: account.userId });
        const member = message.guild.members.cache.get(user?.ownerId || '');

        if (user && user.ownerId === mentionId) {
          // Tags already linked to the target user trigger a refresh of roles and nicknames via the centralized MemberManager.
          yield* linkedTag(message.guild, mentionId, player);
          embed.setDescription(`${titleField}Re-linked to **${member?.user.tag || mentionId}**.`);
        } else if (user) {
          // Tags linked to different users are handled according to the current owner's server status.
          if (member) {
            // Ownership changes are prohibited if the current owner is still present in the server to prevent unauthorized link transfers.
            embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`);
          } else {
            // Absence of the current owner from the server permits the transfer of ownership to a new user.
            yield* UserAdapter.update({ ...user, ownerId: mentionId });
            yield* linkedTag(message.guild, mentionId, player);
            const newMember = message.guild.members.cache.get(mentionId);
            embed.setDescription(`${titleField}Owner changed to **${newMember?.user.tag || mentionId}**.`);
          }
        }
        yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
        return;
      }

      // New linking requests prompt a confirmation dialog to ensure user intent.
      embed.setDescription(`${titleField}Are you sure you want to link this account?`);
      const msg = yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
      yield* Effect.tryPromise(() => msg.react('✅'));
      yield* Effect.tryPromise(() => msg.react('❎'));

      const filter = (r: MessageReaction, u: DiscordUser) => ['✅', '❎'].includes(r.emoji.name!) && u.id === message.author.id;
      // Reaction monitoring waits for user input, treating a lack of response within sixty seconds as a cancellation.
      const collected = yield* Effect.tryPromise(() => msg.awaitReactions({ filter, max: 1, time: 60_000 })).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );

      yield* Effect.tryPromise(() => msg.reactions.removeAll());

      if (collected?.first()?.emoji.name === '✅') {
        // Confirmed requests result in the upserting of user and account records followed by a role update.
        const user = yield* UserAdapter.findOneAndUpdate({ ownerId: mentionId }, { ownerId: mentionId }, { upsert: true });
        yield* AccountAdapter.findOneAndUpdate({ tag }, { tag, userId: user!.id }, { upsert: true });
        yield* linkedTag(message.guild, mentionId, player);
        const member = message.guild.members.cache.get(mentionId);
        embed.setDescription(`${titleField}Linked to **${member?.user.tag || mentionId}**.`);
      } else {
        // Cancellations and timeouts result in the termination of the linking operation.
        const description =
          (collected?.size ?? 0) > 0 ? `${titleField}Operation canceled.` : `${titleField}No answer after 60 seconds, operation canceled.`;
        embed.setDescription(description);
      }

      yield* Effect.tryPromise(() => msg.edit({ embeds: [embed] }));
    }).pipe(
      // The operation queue is cleared upon completion or error to allow subsequent requests from the same user.
      Effect.ensuring(Effect.sync(() => linkQueue.delete(message.author.id))),
    );
  });
