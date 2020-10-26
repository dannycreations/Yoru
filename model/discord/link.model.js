const client = require('./../index.model.js')

class LinkModel extends client.IndexModel {
  constructor() {
    super()
    this.protect = []
  }
  
  async run(message, args) {
    try {
      if (message.member.roles.cache.some(role => role.name !== 'Manager')) return
      if (args[0] && args[0].match(/^#[0289PYLQGRJCUV]+$/) && args[1]) {
        if (this.protect.includes(message.author.id)) {
          const field = `> ${message.content}\nYou must complete previous operation before create new one.`
          return message.channel.send(field)
        }
        this.protect.push(message.author.id)
        const mention = args[1].match(/^<@!?(\d+)>$/)
        if (mention) {
          await this.link(message, args[0], mention[1])
        } else {
          if (message.author.id === this.dconfig.authorid) {
            await this.link(message, args[0], args[1])
          }
        }
        this._.pull(this.protect, message.author.id)
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
      const res = await this.cclient.playerByTag(tag.toUpperCase())
      const embed = new this.discord.MessageEmbed()
      embed.setColor('#0099ff')
      if (res.league) thumbLeague = res.league.iconUrls.medium
      else thumbLeague = this.demoji.thumbnail.replace('{0}', 'noleague.png')
      embed.setAuthor(`${res.name} (${res.tag})`, thumbLeague)
      embed.setThumbnail(this.demoji.thumbnail.replace('{0}', `townhall-${res.townHallLevel}.png`))
      const titlefield = `${this.demoji.level} ${res.expLevel} ${this.demoji.trophies} ${res.trophies.toLocaleString()} ${this.demoji.attackwin} ${res.attackWins.toLocaleString()}`
      embed.addField(titlefield, 'Are you sure want to link this account?')
      if (res.clan) {
        thumbClan = res.clan.badgeUrls.medium
        const role = this.parseClanRole(res.role)
        embed.setFooter(`${role} of ${res.clan.name}\n(${res.clan.tag})`, thumbClan)
      } else {
        thumbClan = this.demoji.thumbnail.replace('{0}', 'noclan.png')
        embed.setFooter('Player is clanless', thumbClan)
      }
      let dataUsr = await this.dbUsr.find({ 'account.playertag': tag }).select({ uid: 1 }).lean()
      const member = message.guild.members.cache.get(dataUsr.length > 0 ? dataUsr[0].uid : user)
      if (dataUsr.length > 0) {
        embed.fields = []
        embed.addField(titlefield, `Already linked to **${member.user.tag}**.`)
        message.channel.send(embed)
      } else {
        const msg = await message.channel.send(embed)
        await msg.react('✅')
        await msg.react('❎')
        try {
          const filter = (reaction, user) => {
            return ['✅', '❎'].includes(reaction.emoji.name) && user.id === message.author.id
          }
          let reaction = await msg.awaitReactions(filter, { max: 1, time: 60000, errors: ['time'] })
          reaction = reaction.first()
          await msg.reactions.removeAll()
          if (reaction.emoji.name === '❎') {
            embed.fields = []
            embed.addField(titlefield, 'Operation canceled.')
            await msg.edit(embed)
          } else {
            let role = message.guild.roles.cache.find(role => role.name === 'Entry')
            await member.roles.remove(role)
            dataUsr = await this.dbUsr.findOneAndUpdate({ uid: user }, {
              $push: {
                account: {
                  playertag: tag,
                  date: this.moment().unix()
                }
              }
            }, { upsert: true, new: true })
            if (dataUsr.account.length === 1) {
              if (res.clan && res.clan.tag === this.dconfig.clantag) {
                if (res.role === 'leader') {
                  role = message.guild.roles.cache.find(role => role.name === 'Leader')
                  await member.roles.add(role)
                  await member.setNickname(`Lead - ${res.name}`)
                } else if (res.role === 'coLeader') {
                  role = message.guild.roles.cache.find(role => role.name === 'Co-Leaders')
                  await member.roles.add(role)
                  await member.setNickname(`Co - ${res.name}`)
                } else if (res.role === 'admin') {
                  role = message.guild.roles.cache.find(role => role.name === 'Elders')
                  await member.roles.add(role)
                  await member.setNickname(`Eld - ${res.name}`)
                } else {
                  role = message.guild.roles.cache.find(role => role.name === 'Members')
                  await member.roles.add(role)
                  await member.setNickname(`Mem - ${res.name}`)
                }
              } else {
                role = message.guild.roles.cache.find(role => role.name === 'Approved')
                await member.roles.add(role)
                await member.setNickname(`TH ${res.townHallLevel} - ${res.name}`)
              }
            }
            embed.fields = []
            embed.addField(titlefield, `Linked to **${member.user.tag}**.`)
            msg.edit(embed)
          }
        } catch(err) {
          await msg.reactions.removeAll()
          embed.fields = []
          embed.addField(titlefield, 'No answer after 60 seconds, operation canceled.')
          msg.edit(embed)
        }
      }
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
}

module.exports = new LinkModel()