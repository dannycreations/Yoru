const _ = require('lodash')
const moment = require('moment')
const Client = require('./../client')

class CheckDiscord extends Client {
  async run(message, args) {
    try {
      if (_.isNil(args[0])) return
      const mention = args[0].match(/^<@!?(\d+)>$/)
      const playerTag = args[0].toUpperCase()
      if (args[0].toLowerCase() === 'members') {
        this.checkMembers(message)
      } else if (_.isArray(mention)) {
        const dataUsr = await this.dbUsr.find({ uid: mention[1] }).lean()
        if (dataUsr.length === 0) {
          const field = `> ${message.content}\nThere is no playertag linked to this user.`
          return message.channel.send(field)
        }
        const countUsr = parseInt(args[1]) ? parseInt(args[1]) : 1
        if (parseInt(args[1]) > 0 && countUsr <= dataUsr[0].account.length) {
          this.check(message, dataUsr[0].account[countUsr - 1].playertag)
        } else {
          this.profile(message, dataUsr[0])
        }
      } else if (playerTag.match(/^#[0289PYLQGRJCUV]+$/)) {
        this.check(message, playerTag)
      } else if (_.isNumber(_.toNumber(args[0]))) {
        if (message.author.id === this.dconfig.authorid) {
          const dataUsr = await this.dbUsr.find({ uid: args[0] }).lean()
          this.profile(message, dataUsr[0])
        }
      } else {
        this.errorHandle(message, { statusCode: 404 })
      }
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
  
  async profile(message, dataUsr) {
    try {
      let count = 1
      const member = message.guild.members.cache.get(dataUsr.uid)
      const embed = new this.discord.MessageEmbed()
      embed.setColor('#0099ff')
      embed.setAuthor(`${member.user.tag}`, member.user.displayAvatarURL())
      embed.setDescription(`Joined ${moment.utc(member.joinedAt).fromNow()}`)
      embed.setThumbnail(member.user.displayAvatarURL())
      for (const account of dataUsr.account) {
        const res = await this.cclient.playerByTag(account.playertag)
        .catch(err => { return false })
        if (res) {
          const field = `${this.dconfig.emojis.level} ${res.expLevel} ${this.dconfig.emojis.trophies} ${res.trophies.toLocaleString()} ${this.dconfig.emojis.attackwin} ${res.attackWins.toLocaleString()}`
          embed.addField(`${count++}. ${this.dconfig.emojis.townhalls[res.townHallLevel - 1]} ${res.name}`, field)
        } else {
          embed.addField(`${count++}. ${this.dconfig.emojis.townhalls[0]} ${account.playertag}`, '⛔ Has been banned!')
        }
      }
      embed.setFooter(message.author.username, message.author.displayAvatarURL())
      embed.setTimestamp()
      message.channel.send(embed)
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
  
  async check(message, tag) {
    try {
      let thumbLeague, thumbClan
      const res = await this.cclient.playerByTag(tag)
      const embed = new this.discord.MessageEmbed()
      embed.setColor('#0099ff')
      embed.setTitle('Open in Clash of Clans ↗')
      embed.setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${tag}`)
      if (res.league) thumbLeague = res.league.iconUrls.medium
      else thumbLeague = _.replace(this.dconfig.emojis.thumbnail, '{0}', 'noleague.png')
      embed.setAuthor(`${res.name} (${res.tag})`, thumbLeague)
      embed.setThumbnail(_.replace(this.dconfig.emojis.thumbnail, '{0}', `townhall-${res.townHallLevel}.png`))
      embed.addField('Profiles', `${this.dconfig.emojis.level} ${res.expLevel} ${this.dconfig.emojis.trophies} ${res.trophies.toLocaleString()} ${this.dconfig.emojis.attackwin} ${res.attackWins.toLocaleString()}`)
      let troops = '', darkTroops = '', superTroops = '', spells = '', darkSpells = '', siegeMachines = '', heroes = '', achievements = ''
      const filterTroops = _.filter(res.troops, { village: 'home' })
      for (const troop of filterTroops) {
        const troopsName = [
          'Barbarian',
          'Archer',
          'Goblin',
          'Giant',
          'Wall Breaker',
          'Balloon',
          'Wizard',
          'Healer',
          'Dragon',
          'P.E.K.K.A',
          'Baby Dragon',
          'Miner',
          'Yeti',
          'Electro Dragon'
        ]
        const darkTroopsName = [
          'Minion',
          'Hog Rider',
          'Valkyrie',
          'Golem',
          'Witch',
          'Lava Hound',
          'Bowler',
          'Ice Golem',
          'Headhunter'
        ]
        const superTroopsName = [
          'Super Barbarian',
          'Super Archer',
          'Super Wall Breaker',
          'Super Giant',
          'Sneaky Goblin',
          'Inferno Dragon',
          'Super Valkyrie',
          'Super Witch',
          'Super Minion'
        ]
        const siegeMachinesName = [
          'Wall Wrecker',
          'Battle Blimp',
          'Stone Slammer',
          'Siege Barracks'
        ]
        const field = this.dconfig.emojis.troops[troop.name] + '**' + troop.level + '**/' + troop.maxLevel + ' '
        if (_.includes(troopsName, troop.name)) troops += field
        else if (_.includes(darkTroopsName, troop.name)) darkTroops += field
        else if (_.includes(superTroopsName, troop.name)) superTroops += field
        else if (_.includes(siegeMachinesName, troop.name)) siegeMachines += field
      }
      if (troops) embed.addField('Troops', troops)
      if (darkTroops) embed.addField('Dark Troops', darkTroops)
      if (superTroops) embed.addField('Super Troops', superTroops)
      if (siegeMachines) embed.addField('Siege Machines', siegeMachines)
      const filterSpells = _.filter(res.spells, { village: 'home' })
      for (const spell of filterSpells) {
        const spellsName = [
          'Lightning Spell',
          'Healing Spell',
          'Rage Spell',
          'Jump Spell',
          'Freeze Spell',
          'Clone Spell'
        ]
        const darkSpellsName = [
          'Poison Spell',
          'Earthquake Spell',
          'Haste Spell',
          'Skeleton Spell',
          'Bat Spell'
        ]
        const field = this.dconfig.emojis.spells[spell.name] + '**' + spell.level + '**/' + spell.maxLevel + ' '
        if (_.includes(spellsName, spell.name)) spells += field
        else if (_.includes(darkSpellsName, spell.name)) darkSpells += field
      }
      if (spells) embed.addField('Spells', spells)
      if (darkSpells) embed.addField('Dark Spells', darkSpells)
      const filterHeroes = _.filter(res.heroes, { village: 'home' })
      for (const hero of filterHeroes) {
        heroes += this.dconfig.emojis.heroes[hero.name] + '**' + hero.level + '**/' + hero.maxLevel + ' '
      }
      if (heroes) embed.addField('Heroes', heroes)
      const achievementsName = ['Friend in Need', 'Games Champion']
      const filterAchievements = _.filter(res.achievements, r => _.includes(achievementsName, r.name))
      for (const achievement of filterAchievements) {
        achievements += this.dconfig.emojis.stars[achievement.stars] + ' **' + achievement.name + '** ' + achievement.value.toLocaleString() + '\n'
      }
      if (achievements) embed.addField('Achievements', achievements)
      if (res.clan) {
        thumbClan = res.clan.badgeUrls.medium
        const role = this.parseClanRole(res.role)
        embed.setFooter(`${role} of ${res.clan.name}\n(${res.clan.tag})`, thumbClan)
      } else {
        thumbClan = _.replace(this.dconfig.emojis.thumbnail, '{0}', 'noclan.png')
        embed.setFooter('Player is clanless', thumbClan)
      }
      message.channel.send(embed)
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
  
  async checkMembers(message) {
    try {
      let leaveCount = 0, leaveStr = '', inCount = 0, inStr = '', notInCount = 0, notInStr = ''
      const res = await this.cclient.clanByTag(this.dconfig.clantag)
      for (const data of res.memberList) {
        const field = `**${data.name}** ${data.tag}\n`
        const dataUsr = await this.dbUsr.find({
          'account.playertag': data.tag
        }).lean()
        if (dataUsr.length > 0) {
          const member = message.guild.members.cache.get(dataUsr[0].uid)
          if (_.isNil(member)) leaveCount++, leaveStr += field
          else inCount++, inStr += field
        } else notInCount++, notInStr += field
      }
      let field = `👥 **Total Members in Clan:** ${res.members}\n\n`
      if (leaveStr) field += `🖕 **Members Leave Discord:** ${leaveCount}\n${leaveStr}\n`
      if (inStr) field += `👍 **Members in Discord:** ${inCount}\n${inStr}\n`
      if (notInStr) field += `👎 **Members not in Discord:** ${notInCount}\n${notInStr}`
      message.channel.send(field)
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
}

module.exports = new CheckDiscord()