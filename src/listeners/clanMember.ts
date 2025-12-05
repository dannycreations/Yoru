import { join } from 'node:path';
import { Listener } from '@sapphire/framework';
import { Mutex, Queue } from '@vegapunk/struct';
import { attemptAsync, isObjectLike, remove } from '@vegapunk/utilities/common';
import { isErrorLike, Result } from '@vegapunk/utilities/result';
import { waitForEach } from '@vegapunk/utilities/sleep';
import { GuildMember, Role } from 'discord.js';

import { ClashAPI } from '../lib/api/ClashAPI';
import { ClientEvents, RegisterRoles } from '../lib/core/constants';
import { DBAccount } from '../lib/database/drizzle';
import { userTable } from '../lib/database/schema';
import { getGuildMember, isClanRole, isMemberRole, isModeratorRole } from '../lib/helpers/core.helper';
import { OfflineStore } from '../lib/stores/OfflineStore';

import type { Clan, ClanMember, Player } from 'clashofclans.js';

export class UserListener extends Listener {
  public constructor(context: Listener.LoaderContext) {
    super(context, { emitter: ClashAPI.Instance, event: ClientEvents.ClanMember });
  }

  private readonly runMutex: Mutex = new Mutex();
  public async run(oldClan: Clan, newClan: Clan): Promise<void> {
    await this.runMutex.acquire();

    const { config, sessions } = this.container.client;

    try {
      const clanStore = this.clanStores.get(oldClan.tag);
      if (!clanStore) {
        if (!sessions.data.clans.some((r) => r.tag === oldClan.tag)) {
          sessions.data.clans.push({ name: oldClan.name, tag: oldClan.tag });
          await sessions.writeFile(sessions.data, true);
        }

        const offlineStore = new OfflineStore<Clan>({
          filePath: join(config.dirPath, 'clan', `${oldClan.tag}.json`),
          delay: 60_000,
          init: oldClan,
        });
        await offlineStore.readFile();

        oldClan = offlineStore.data;
        this.clanStores.set(oldClan.tag, offlineStore);
      } else {
        await clanStore.writeFile(oldClan);
      }

      await waitForEach(oldClan.members, (player) => {
        if (newClan.members.some((member) => member.tag === player.tag)) {
          return;
        }

        this.leavingQueue.enqueue(player);
        remove(oldClan.members, (r) => r.tag === player.tag);
      });

      this.leavingHandler();
    } finally {
      this.runMutex.release();
    }
  }

  private readonly leavingMutex: Mutex = new Mutex();
  private readonly leavingQueue: Queue<ClanMember> = new Queue();
  private leavingHandler(): void {
    if (this.leavingMutex.lock()) {
      return;
    }

    queueMicrotask(async () => {
      const { config } = this.container.client;

      const result = await Result.fromAsync(async () => {
        const player = this.leavingQueue.dequeue();
        if (!player) {
          return;
        }

        const getAccount = DBAccount.findOne({ tag: player.tag });
        Result.assert(getAccount.isOk(), `Account not found ${player.tag}`, { ...getAccount, tag: player.tag });

        const userId = getAccount.unwrap()?.userId;
        if (!userId) {
          this.container.logger.info(`${player.tag}: Unregistered player left clan.`);
          return;
        } else {
          this.container.logger.info(`${player.tag}: Registered player left clan.`);
        }

        const getUser = DBAccount.find({ userId }, { joins: [{ table: userTable, on: { userId: 'id' } }] });
        Result.assert(getUser.isOk(), `User not found ${userId}`, { ...getUser, userId });

        let playerData: Player | undefined;
        const dataAccount = getUser.unwrap().map((r) => r.account);
        await waitForEach(dataAccount, async (account) => {
          if (account.isBanned || account.tag === player.tag) {
            return false;
          }

          const [error, getPlayerData] = await attemptAsync(() => ClashAPI.Instance.getPlayer(account.tag));
          if (isObjectLike(getPlayerData) && 'clan' in getPlayerData) {
            if (getPlayerData.clan && config.data.clanTags.includes(getPlayerData.clan.tag)) {
              playerData = getPlayerData;
              return true;
            }
          } else if (isErrorLike(error) && 'reason' in error) {
            if (error.reason === 'notFound') {
              account.isBanned = true;
              account.bannedAt = Date.now();
              DBAccount.update(account);
            }
          }
          return false;
        });

        const dataUser = getUser.unwrap()[0].user;
        const [_, getMember] = await getGuildMember(dataUser.ownerId);
        if (getMember instanceof GuildMember && !getMember.roles.cache.some(isModeratorRole)) {
          if (isObjectLike(playerData) && playerData && 'name' in playerData) {
            let nickname = playerData.name;
            if (getMember.user.username.toLowerCase() === playerData.name.toLowerCase()) {
              nickname = `${playerData.name} ${playerData.tag}`;
            }

            await getMember.setNickname(nickname);
            this.container.logger.info(`${player.tag}: Nick updated ${getMember.user.displayName} to ${nickname}`);
          } else {
            const memberRole = (r: Role) => isMemberRole(r) || isClanRole(r);
            await getMember.roles.remove(getMember.guild.roles.cache.filter(memberRole));

            const registerRole = (r: Role) => r.name === RegisterRoles.Reapply;
            await getMember.roles.add(getMember.guild.roles.cache.filter(registerRole));

            this.container.logger.info(`${player.tag}: Added ${RegisterRoles.Reapply} to ${getMember.user.displayName}`);
          }

          await waitForEach(dataAccount, (r) => {
            this.leavingQueue.delete((s) => r.tag === s.tag);
          });
        }
      });
      result.inspectErr((error) => {
        ClashAPI.Instance.emit(ClientEvents.ApiError, null, error);
      });

      this.leavingMutex.release();
      if (this.leavingQueue.size > 0) {
        this.container.logger.warn(`LeavingQueue has ${this.leavingQueue.size} items. Re-triggering.`);
        this.leavingHandler();
      }
    });
  }

  private readonly clanStores: Map<string, OfflineStore<Clan>> = new Map();
}
