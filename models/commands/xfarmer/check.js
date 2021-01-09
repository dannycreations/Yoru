'use strict'
const _ = require('lodash')
const moment = require('moment')
const { Command } = require('discord-akairo')

module.exports = class CheckCommand extends Command {
  constructor() {
    super('check', {
      aliases: ['check', 'c'],
      description: {
        content: ''
      },
      args: [{
        id: 'account',
        type: 'uppercase'
      }, {
        id: 'page',
        type: 'number'
      }]
    })
  }
  
  async exec(message, { account, page }) {
    this.message = message
    const field = `> ${message.content}\nPlease wait, this may take some time.`
    await message.util.send(field)
    if (account.toLowerCase() === 'members') {
      return this.checkMembers()
    } if (account.match(/^#[0289CGJLPQRUVY]+$/)) {
      return this.check(account)
    }
    const mention = account.match(/^<@!?(\d+)>$/)
    if (_.isArray(mention)) {
      const dataUsr = await this.client.dbUsr.find({ uid: mention[1] }).lean()
      if (!dataUsr.length) {
        const field = `> ${message.content}\nThere is no playertag linked to this user.`
        return message.util.send(field)
      }
      const countUsr = _.toNumber(page) ? _.toNumber(page) : 1
      if (_.toNumber(page) && countUsr <= dataUsr[0].account.length) {
        return this.check(dataUsr[0].account[countUsr - 1].playertag)
      } else {
        return this.profile(dataUsr[0])
      }
    } else if (_.toNumber(account)) {
      if (message.author.id === this.client.ownerID) {
        const dataUsr = await this.client.dbUsr.find({ uid: account }).lean()
        if (!dataUsr.length) {
          const field = `> ${message.content}\nThere is no playertag linked to this user.`
          return message.util.send(field)
        }
        const countUsr = _.toNumber(page) ? _.toNumber(page) : 1
        if (_.toNumber(page) && countUsr <= dataUsr[0].account.length) {
          return this.check(dataUsr[0].account[countUsr - 1].playertag)
        } else {
          return this.profile(dataUsr[0])
        }
      }
    } else {
      return this.client.errorHandle(message, { statusCode: 404 })
    }
  }
  
  async profile(dataUsr) {
    try {
      let count = 1
      const member = this.message.guild.members.cache.get(dataUsr.uid)
      const embed = this.client.util.embed()
      .setColor('#0099ff')
      .setAuthor(`${member.user.tag}`, member.user.displayAvatarURL())
      .setDescription(`Joined ${moment.utc(member.joinedAt).fromNow()}`)
      .setThumbnail(member.user.displayAvatarURL())
      for (const account of dataUsr.account) {
        const res = await this.client.clashApi.playerByTag(account.playertag)
        .catch(e => { if (e.statusCode === 404) return false; throw e })
        if (res) {
          const field = `${this.client.config.emojis.level} ${res.expLevel} ${this.client.config.emojis.trophies} ${res.trophies.toLocaleString()} ${this.client.config.emojis.attackwin} ${res.attackWins.toLocaleString()}`
          embed.addField(`${count++}. ${this.client.config.emojis.townhalls[res.townHallLevel - 1]} ${res.name}`, field)
        } else {
          embed.addField(`${count++}. ${this.client.config.emojis.townhalls[0]} ${account.playertag}`, '⛔ Has been banned!')
        }
      }
      embed.setFooter(this.message.author.username, this.message.author.displayAvatarURL())
      embed.setTimestamp()
      return this.message.util.send(null, embed)
    } catch (e) {
      await this.client.errorHandle(this.message, e)
      return this.profile(dataUsr)
    }
  }
  
  async check(tag) {
    try {
      let thumbLeague, thumbClan
      const res = await this.client.clashApi.playerByTag(tag)
      const embed = this.client.util.embed()
      embed.setColor('#0099ff')
      embed.setTitle('Open in Clash of Clans ↗')
      embed.setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${tag}`)
      if (res.league) thumbLeague = res.league.iconUrls.medium
      else thumbLeague = _.replace(this.client.config.emojis.thumbnail, '{0}', 'noleague.png')
      embed.setAuthor(`${res.name} (${res.tag})`, thumbLeague)
      embed.setThumbnail(_.replace(this.client.config.emojis.thumbnail, '{0}', `townhall-${res.townHallLevel}.png`))
      embed.addField('Profiles', `${this.client.config.emojis.level} ${res.expLevel} ${this.client.config.emojis.trophies} ${res.trophies.toLocaleString()} ${this.client.config.emojis.attackwin} ${res.attackWins.toLocaleString()}`)
      let troops = '', darkTroops = '', superTroops = '', spells = '', darkSpells = '', siegeMachines = '', heroes = '', achievements = ''
      for (const troop of _.filter(res.troops, { village: 'home' })) {
        const troopNormal = this.client.config.emojis.troops.normal
        const troopDark = this.client.config.emojis.troops.dark
        const troopSuper = this.client.config.emojis.troops.super
        const troopSiege = this.client.config.emojis.troops.siege
        const field = '**' + troop.level + '**/' + troop.maxLevel + ' '
        if (_.includes(Object.keys(troopNormal), troop.name)) {
          troops += troopNormal[troop.name] + field
        } else if (_.includes(Object.keys(troopDark), troop.name)) {
          darkTroops += troopDark[troop.name] + field
        } else if (_.includes(Object.keys(troopSuper), troop.name)) {
          superTroops += troopSuper[troop.name] + field
        } else if (_.includes(Object.keys(troopSiege), troop.name)) {
          siegeMachines += troopSiege[troop.name] + field
        }
      }
      if (troops) embed.addField('Troops', troops)
      if (darkTroops) embed.addField('Dark Troops', darkTroops)
      if (superTroops) embed.addField('Super Troops', superTroops)
      if (siegeMachines) embed.addField('Siege Machines', siegeMachines)
      for (const spell of _.filter(res.spells, { village: 'home' })) {
        const spellNormal = this.client.config.emojis.spells.normal
        const spellDark = this.client.config.emojis.spells.dark
        const field = '**' + spell.level + '**/' + spell.maxLevel + ' '
        if (_.includes(Object.keys(spellNormal), spell.name)) {
          spells += spellNormal[spell.name] + field
        } else if (_.includes(Object.keys(spellDark), spell.name)) {
          darkSpells += spellDark[spell.name] + field
        }
      }
      if (spells) embed.addField('Spells', spells)
      if (darkSpells) embed.addField('Dark Spells', darkSpells)
      for (const hero of _.filter(res.heroes, { village: 'home' })) {
        heroes += this.client.config.emojis.heroes[hero.name] + '**' + hero.level + '**/' + hero.maxLevel + ' '
      }
      if (heroes) embed.addField('Heroes', heroes)
      const achievementsName = ['Friend in Need', 'Games Champion']
      for (const achievement of _.filter(res.achievements, r => _.includes(achievementsName, r.name))) {
        achievements += this.client.config.emojis.stars[achievement.stars] + ' **' + achievement.name + '** ' + achievement.value.toLocaleString() + '\n'
      }
      if (achievements) embed.addField('Achievements', achievements)
      if (res.clan) {
        thumbClan = res.clan.badgeUrls.medium
        const role = this.client.parseClanRole(res.role)
        embed.setFooter(`${role} of ${res.clan.name}\n(${res.clan.tag})`, thumbClan)
      } else {
        thumbClan = _.replace(this.client.config.emojis.thumbnail, '{0}', 'noclan.png')
        embed.setFooter('Player is clanless', thumbClan)
      }
      return this.message.util.send(null, embed)
    } catch (e) {
      await this.client.errorHandle(this.message, e)
      return this.check(tag)
    }
  }
  
  async checkMembers() {
    try {
      let field = ''
      for (const page of this.client.config.clanTag) {
        let leaveCount = 0, leaveStr = '', inCount = 0, inStr = '', notInCount = 0, notInStr = ''
        const res = await this.client.clashApi.clanByTag(page)
        for (const data of res.memberList) {
          const field = `**${data.name}** ${data.tag}\n`
          const dataUsr = await this.client.dbUsr.find({
            'account.playertag': data.tag
          }).lean()
          if (dataUsr.length) {
            const member = this.message.guild.members.cache.get(dataUsr[0].uid)
            if (_.isNil(member)) leaveCount++, leaveStr += field
            else inCount++, inStr += field
          } else notInCount++, notInStr += field
        }
        field += `👥 **Total Members in Clan:** ${res.members}\n\n`
        if (leaveStr) field += `🖕 **Members Leave Discord:** ${leaveCount}\n${leaveStr}\n`
        if (inStr) field += `👍 **Members in Discord:** ${inCount}\n${inStr}\n`
        if (notInStr) field += `👎 **Members not in Discord:** ${notInCount}\n${notInStr}\n`
      }
      return this.message.util.send(field)
    } catch (e) {
      await this.client.errorHandle(this.message, e)
      return this.checkMembers()
    }
  }
}