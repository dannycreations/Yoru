const _ = require('lodash')
const moment = require('moment')
const Client = require('./../client')

class LinkDiscord extends Client {
  constructor() {
    super()
    this.protect = []
  }
  
  async run(message, args) {
    try {
      if (_.isNil(args[1])) return
      if (!message.member.roles.cache.some(r => r.name === 'Manager')) return
      const playerTag = args[0].toUpperCase()
      if (playerTag.match(/^#[0289PYLQGRJCUV]+$/)) {
        if (_.includes(this.protect, message.author.id)) {
          const field = `> ${message.content}\nYou must complete previous operation before create new one.`
          return message.channel.send(field)
        }
        this.protect.push(message.author.id)
        const mention = args[1].match(/^<@!?(\d+)>$/)
        if (_.isArray(mention)) {
          await this.link(message, playerTag, mention[1])
        } else {
          if (message.author.id === this.dconfig.authorid) {
            await this.link(message, playerTag, args[1])
          }
        }
        _.pull(this.protect, message.author.id)
      } else {
        this.errorHandle(message, { statusCode: 404 })
      }
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
  
  async link(message, tag, user) {
    try {
      let thumbLeague, thumbClan
      const res = await this.cclient.playerByTag(tag)
      const embed = new this.discord.MessageEmbed()
      embed.setColor('#0099ff')
      if (res.league) thumbLeague = res.league.iconUrls.medium
      else thumbLeague = _.replace(this.dconfig.emojis.thumbnail, '{0}', 'noleague.png')
      embed.setAuthor(`${res.name} (${res.tag})`, thumbLeague)
      embed.setThumbnail(_.replace(this.dconfig.emojis.thumbnail, '{0}', `townhall-${res.townHallLevel}.png`))
      const titleField = `${this.dconfig.emojis.level} ${res.expLevel} ${this.dconfig.emojis.trophies} ${res.trophies.toLocaleString()} ${this.dconfig.emojis.attackwin} ${res.attackWins.toLocaleString()}\n`
      embed.setDescription(`${titleField}Are you sure want to link this account?`)
      if (res.clan) {
        thumbClan = res.clan.badgeUrls.medium
        const role = this.parseClanRole(res.role)
        embed.setFooter(`${role} of ${res.clan.name}\n(${res.clan.tag})`, thumbClan)
      } else {
        thumbClan = _.replace(this.dconfig.emojis.thumbnail, '{0}', 'noclan.png')
        embed.setFooter('Player is clanless', thumbClan)
      }
      let dataUsr = await this.dbUsr.find({ 'account.playertag': tag }).select({ uid: 1 }).lean()
      const member = message.guild.members.cache.get(dataUsr.length > 0 ? dataUsr[0].uid : user)
      if (dataUsr.length > 0) {
        embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`)
        message.channel.send(embed)
      } else {
        const msg = await message.channel.send(embed)
        await msg.react('✅')
        await msg.react('❎')
        try {
          const filter = (reaction, user) => {
            return _.includes(['✅', '❎'], reaction.emoji.name) && user.id === message.author.id
          }
          let reaction = await msg.awaitReactions(filter, { max: 1, time: 60000, errors: ['time'] })
          reaction = reaction.first()
          await msg.reactions.removeAll()
          if (reaction.emoji.name === '❎') {
            embed.setDescription(`${titleField}Operation canceled.`)
            await msg.edit(embed)
          } else {
            let role = message.guild.roles.cache.find(r => r.name === 'Entry')
            await member.roles.remove(role)
            dataUsr = await this.dbUsr.findOneAndUpdate({ uid: user }, {
              $push: {
                account: {
                  playertag: tag,
                  date: moment().unix()
                }
              }
            }, { upsert: true, new: true })
            if (dataUsr.account.length === 1) {
              if (res.clan && res.clan.tag === this.dconfig.clantag) {
                if (res.role === 'leader') {
                  role = message.guild.roles.cache.find(r => r.name === 'Leader')
                  await member.roles.add(role)
                  await member.setNickname(`Lead - ${res.name}`)
                } else if (res.role === 'coLeader') {
                  role = message.guild.roles.cache.find(r => r.name === 'Co-Leaders')
                  await member.roles.add(role)
                  await member.setNickname(`Co - ${res.name}`)
                } else if (res.role === 'admin') {
                  role = message.guild.roles.cache.find(r => r.name === 'Elders')
                  await member.roles.add(role)
                  await member.setNickname(`Eld - ${res.name}`)
                } else {
                  role = message.guild.roles.cache.find(r => r.name === 'Members')
                  await member.roles.add(role)
                  await member.setNickname(`Mem - ${res.name}`)
                }
              } else {
                role = message.guild.roles.cache.find(r => r.name === 'Approved')
                await member.roles.add(role)
                await member.setNickname(`TH ${res.townHallLevel} - ${res.name}`)
              }
            }
            embed.setDescription(`${titleField}Linked to **${member.user.tag}**.`)
            msg.edit(embed)
          }
        } catch(err) {
          await msg.reactions.removeAll()
          embed.setDescription(`${titleField}No answer after 60 seconds, operation canceled.`)
          msg.edit(embed)
        }
      }
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
}

module.exports = new LinkDiscord()