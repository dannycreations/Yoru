const client = require('./../index.model.js')

class CheckModel extends client.IndexModel {
  constructor() {
    super()
  }
  
  async run(message, args) {
    try {
      if (!args[0]) return
      const mention = args[0].match(/^<@!?(\d+)>$/)
      if (args[0].toLowerCase() === 'members') {
        this.checkMembers(message)
      } else if (mention) {
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
      } else if (args[0].match(/^#[0289PYLQGRJCUV]+$/)) {
        this.check(message, args[0])
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
      embed.setTitle('Open in Clash of Clans ↗')
      embed.setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${dataUsr.account[0].playertag.split('#')[1]}`)
      embed.setAuthor(`${member.user.tag}`, member.user.displayAvatarURL())
      embed.setThumbnail(member.user.displayAvatarURL())
      for (const account of dataUsr.account) {
        const res = await this.cclient.playerByTag(account.playertag)
        .catch(() => { return false })
        if (res) {
          const field = `${this.demoji.level} ${res.expLevel} ${this.demoji.trophies} ${res.trophies.toLocaleString()} ${this.demoji.attackwin} ${res.attackWins.toLocaleString()}`
          embed.addField(`${count++}. ${res.name}`, field)
        } else {
          embed.addField(`${count++}. ${account.playertag}`, '⛔ Banned')
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
      const res = await this.cclient.playerByTag(tag.toUpperCase())
      const embed = new this.discord.MessageEmbed()
      embed.setColor('#0099ff')
      embed.setTitle('Open in Clash of Clans ↗')
      embed.setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${tag.split('#')[1]}`)
      if (res.league) thumbLeague = res.league.iconUrls.medium
      else thumbLeague = this.demoji.thumbnail.replace('{0}', 'noleague.png')
      embed.setAuthor(`${res.name} (${res.tag})`, thumbLeague)
      embed.setThumbnail(this.demoji.thumbnail.replace('{0}', `townhall-${res.townHallLevel}.png`))
      embed.addField('Profiles', `${this.demoji.level} ${res.expLevel} ${this.demoji.trophies} ${res.trophies.toLocaleString()} ${this.demoji.attackwin} ${res.attackWins.toLocaleString()}`)
      let troops = '', darkTroops = '', superTroops = '', spells = '', darkSpells = '', siegeMachines = '', heroes = '', achievements = ''
      for (const troop of res.troops) {
        if (troop.village === 'home') {
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
          if (troopsName.includes(troop.name)) {
            troops += this.demoji.troops[troop.name] + '**' + troop.level + '**/' + troop.maxLevel + ' '
          } else if (darkTroopsName.includes(troop.name)) {
            darkTroops += this.demoji.troops[troop.name] + '**' + troop.level + '**/' + troop.maxLevel + ' '
          } else if (superTroopsName.includes(troop.name)) {
            superTroops += this.demoji.troops[troop.name] + '**' + troop.level + '**/' + troop.maxLevel + ' '
          } else if (superTroopsName.includes(troop.name)) {
            siegeMachines += this.demoji.troops[troop.name] + '**' + troop.level + '**/' + troop.maxLevel + ' '
          }
        }
      }
      if (troops) embed.addField('Troops', troops)
      if (darkTroops) embed.addField('Dark Troops', darkTroops)
      if (superTroops) embed.addField('Super Troops', superTroops)
      if (siegeMachines) embed.addField('Siege Machines', siegeMachines)
      for (const spell of res.spells) {
        if (spell.village === 'home') {
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
          if (spellsName.includes(spell.name)) {
            spells += this.demoji.spells[spell.name] + '**' + spell.level + '**/' + spell.maxLevel + ' '
          } else if (darkSpellsName.includes(spell.name)) {
            darkSpells += this.demoji.spells[spell.name] + '**' + spell.level + '**/' + spell.maxLevel + ' '
          }
        }
      }
      if (spells) embed.addField('Spells', spells)
      if (darkSpells) embed.addField('Dark Spells', darkSpells)
      for (const hero of res.heroes) {
        if (hero.village === 'home') {
          heroes += this.demoji.heroes[hero.name] + '**' + hero.level + '**/' + hero.maxLevel + ' '
        }
      }
      if (heroes) embed.addField('Heroes', heroes)
      for (const achievement of res.achievements) {
        const achievementsName = ['Friend in Need', 'Games Champion']
        if (achievementsName.includes(achievement.name)) {
          achievements += this.demoji.stars[achievement.stars] + ' **' + achievement.name + '** ' + achievement.value.toLocaleString() + '\n'
        }
      }
      if (achievements) embed.addField('Achievements', achievements)
      if (res.clan) {
        thumbClan = res.clan.badgeUrls.medium
        const role = this.parseClanRole(res.role)
        embed.setFooter(`${role} of ${res.clan.name}\n(${res.clan.tag})`, thumbClan)
      } else {
        thumbClan = this.demoji.thumbnail.replace('{0}', 'noclan.png')
        embed.setFooter('Player is clanless', thumbClan)
      }
      message.channel.send(embed)
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
  
  async checkMembers(message) {
    try {
      let withCount = 0, withString = '', withoutCount = 0, withoutString = ''
      const res = await this.cclient.clanByTag(this.dconfig.clantag)
      for (const data of res.memberList) {
        const dataUsr = await this.dbUsr.find({
          'account.playertag': data.tag
        }).select({ _id: 1 }).lean()
        if (dataUsr.length > 0) withCount++, withString += `**${data.name}** ${data.tag}\n`
        else withoutCount++, withoutString += `**${data.name}** ${data.tag}\n`
      }
      let field = `👥 **Total Members in Clan:** ${res.members}\n\n`
      field += `👍 **Members in Discord:** ${withCount}\n${withString}\n`
      field += `👎 **Members not in Discord:** ${withoutCount}\n${withoutString}`
      message.channel.send(field)
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
}

module.exports = new CheckModel()