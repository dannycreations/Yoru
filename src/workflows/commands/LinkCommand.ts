import { SnowflakeRegex, UserOrMemberMentionRegex } from '@sapphire/discord.js-utilities';
import { Util } from 'clashofclans.js';
import { EmbedBuilder } from 'discord.js';
import { Effect } from 'effect';

import { MemberRoles, RegisterRoles } from '../../core/constants';
import { emoji } from '../../core/emojis';
import { ConfigStoreTag } from '../../core/schemas';
import { AccountAdapter, UserAdapter } from '../../database';
import { formatPlayerStats, parseClan } from '../../helpers/clash.helper';
import { isModeratorRole, isRegisterRole } from '../../helpers/role.helper';
import { ClashTag } from '../../services/ClashService';

import type { Player } from 'clashofclans.js';
import type { User as DiscordUser, Message, MessageReaction } from 'discord.js';

const linkedTag = (message: Message<true>, ownerId: string, player: Player) =>
  Effect.gen(function* () {
    const member = message.guild.members.cache.get(ownerId);
    if (!member) return;

    const configStore = yield* ConfigStoreTag;
    const config = yield* configStore.get;
    const rolesToRemove = message.guild.roles.cache.filter(isRegisterRole);
    yield* Effect.tryPromise(() => member.roles.remove(rolesToRemove));

    if (player.clan && config.clanTags.includes(player.clan.tag)) {
      const clanName = player.clan.name;
      const rolesToAdd = message.guild.roles.cache.filter((r) => r.name === clanName || r.name === MemberRoles.Elder);
      yield* Effect.tryPromise(() => member.roles.add(rolesToAdd));
      const nickname = member.user.username.toLowerCase() === player.name.toLowerCase() ? `${player.name} ${player.tag}` : player.name;
      yield* Effect.tryPromise(() => member.setNickname(nickname));
    } else {
      const approvedRole = message.guild.roles.cache.find((r) => r.name === RegisterRoles.Approved);
      if (approvedRole) yield* Effect.tryPromise(() => member.roles.add(approvedRole));
      yield* Effect.tryPromise(() => member.setNickname(`TH ${player.townHallLevel} - ${player.name}`));
    }
  });

const linkQueue = new Set<string>();

export const linkCommand = (message: Message<true>, args: string[]) =>
  Effect.gen(function* () {
    const { client: clash } = yield* ClashTag;
    const tag = args[0];
    const mention = args[1];

    // Validate player tag format using clashofclans.js utility
    if (!tag || !Util.isValidTag(tag)) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nError, Player tag not valid!`));
      return;
    }

    // Prevent concurrent link operations from the same author to avoid race conditions
    if (linkQueue.has(message.author.id)) {
      yield* Effect.tryPromise(() => message.reply(`> ${message.content}\nYou must complete previous operation before create new one.`));
      return;
    }
    linkQueue.add(message.author.id);

    yield* Effect.gen(function* () {
      // Extract mentionId from either a mention or a raw snowflake
      const mentionId = mention?.match(UserOrMemberMentionRegex)?.[1] || (SnowflakeRegex.test(mention) ? mention : null);
      if (!mentionId) {
        yield* Effect.tryPromise(() => message.reply('Please mention a user to link.'));
        return;
      }

      const configStore = yield* ConfigStoreTag;
      const config = yield* configStore.get;
      // Authorization check: only owners or moderators can link tags
      const isAuthorized = config.ownerIds.includes(message.author.id) || message.member?.roles.cache.some(isModeratorRole);
      if (!isAuthorized) return;

      // Fetch player data to display in the confirmation embed
      const player = yield* Effect.tryPromise(() => clash.getPlayer(tag));
      const embed = new EmbedBuilder().setColor('#0099ff').setFooter(parseClan(player));
      const thumbLeague = player.leagueTier ? player.leagueTier.icon.medium : emoji.thumbnail.replace('{0}', 'badges/noleague.png');
      embed.setAuthor({ name: `${player.name} (${player.tag})`, iconURL: thumbLeague });
      embed.setThumbnail(emoji.thumbnail.replace('{0}', `townhalls/townhall-${player.townHallLevel}.png`));

      const titleField = `${formatPlayerStats(player)}\n`;

      // Check if the tag is already linked in the database
      const account = yield* AccountAdapter.findOne({ tag });
      if (account) {
        const user = yield* UserAdapter.findOne({ id: account.userId });
        const member = message.guild.members.cache.get(user?.ownerId || '');

        if (user && user.ownerId === mentionId) {
          // Case 1: Tag already linked to the target user. Refresh roles/nick
          yield* linkedTag(message, mentionId, player);
          embed.setDescription(`${titleField}Re-linked to **${member?.user.tag || mentionId}**.`);
        } else if (user) {
          // Case 2: Tag linked to a different user
          if (member) {
            // Only allow ownership change if the current owner has left the server
            // This prevents users from "stealing" links from active members
            embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`);
          } else {
            // Current owner left the server, allow changing ownership to the new user
            yield* UserAdapter.update({ ...user, ownerId: mentionId });
            yield* linkedTag(message, mentionId, player);
            const newMember = message.guild.members.cache.get(mentionId);
            embed.setDescription(`${titleField}Owner changed to **${newMember?.user.tag || mentionId}**.`);
          }
        }
        yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
        return;
      }

      // Case 3: New link. Ask for confirmation
      embed.setDescription(`${titleField}Are you sure you want to link this account?`);
      const msg = yield* Effect.tryPromise(() => message.reply({ embeds: [embed] }));
      yield* Effect.tryPromise(() => msg.react('✅'));
      yield* Effect.tryPromise(() => msg.react('❎'));

      const filter = (r: MessageReaction, u: DiscordUser) => ['✅', '❎'].includes(r.emoji.name!) && u.id === message.author.id;
      // Wait for user reaction. If no reaction within 60s, it's treated as a cancellation
      const collected = yield* Effect.tryPromise(() => msg.awaitReactions({ filter, max: 1, time: 60_000 })).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );

      yield* Effect.tryPromise(() => msg.reactions.removeAll());

      if (collected?.first()?.emoji.name === '✅') {
        // User confirmed: upsert user and account records, then update roles
        const user = yield* UserAdapter.findOneAndUpdate({ ownerId: mentionId }, { ownerId: mentionId }, { upsert: true });
        yield* AccountAdapter.findOneAndUpdate({ tag }, { tag, userId: user!.id }, { upsert: true });
        yield* linkedTag(message, mentionId, player);
        const member = message.guild.members.cache.get(mentionId);
        embed.setDescription(`${titleField}Linked to **${member?.user.tag || mentionId}**.`);
      } else {
        // User cancelled or timed out
        const description = collected ? `${titleField}Operation canceled.` : `${titleField}No answer after 60 seconds, operation canceled.`;
        embed.setDescription(description);
      }

      yield* Effect.tryPromise(() => msg.edit({ embeds: [embed] }));
    }).pipe(
      // Ensure the queue is cleared even if an error occurs
      Effect.ensuring(Effect.sync(() => linkQueue.delete(message.author.id))),
    );
  });
