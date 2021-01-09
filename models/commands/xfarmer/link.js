'use strict'
const _ = require('lodash')
const moment = require('moment')
const { Command } = require('discord-akairo')

module.exports = class CheckCommand extends Command {
  constructor() {
    super('link', {
      aliases: ['link', 'l'],
      description: {
        content: ''
      },
      args: [{
        id: 'account',
        type: 'uppercase'
      }, {
        id: 'mention',
        type: 'string'
      }]
    })
    this.protect = []
  }
  
  userPermissions(message) {
    if (!message.member.roles.cache.some(r => r.name === 'Manager')) {
      return 'Manager'
    } return null
  }
  
  async exec(message, { account, mention }) {
    if (_.isNull(account) || _.isNull(mention)) return
    this.message = message
    const field = `> ${message.content}\nPlease wait, this may take some time.`
    await message.util.send(field)
    if (account.match(/^#[0289CGJLPQRUVY]+$/)) {
      if (_.includes(this.protect, message.author.id)) {
        const field = `> ${message.content}\nYou must complete previous operation before create new one.`
        return message.util.send(field)
      }
      this.protect.push(message.author.id)
      const mMatch = mention.match(/^<@!?(\d+)>$/)
      if (_.isArray(mMatch)) {
        await this.link(account, mMatch[1])
      } else {
        if (message.author.id === this.client.ownerID) {
          await this.link(account, mention)
        }
      }
      _.pull(this.protect, message.author.id)
    } else {
      return this.client.errorHandle(message, { statusCode: 404 })
    }
  }
  
  async link(tag, user) {
    try {
      let thumbLeague, thumbClan
      const res = await this.client.clashApi.playerByTag(tag)
      const embed = this.client.util.embed()
      embed.setColor('#0099ff')
      if (res.league) thumbLeague = res.league.iconUrls.medium
      else thumbLeague = _.replace(this.client.config.emojis.thumbnail, '{0}', 'noleague.png')
      embed.setAuthor(`${res.name} (${res.tag})`, thumbLeague)
      embed.setThumbnail(_.replace(this.client.config.emojis.thumbnail, '{0}', `townhall-${res.townHallLevel}.png`))
      const titleField = `${this.client.config.emojis.level} ${res.expLevel} ${this.client.config.emojis.trophies} ${res.trophies.toLocaleString()} ${this.client.config.emojis.attackwin} ${res.attackWins.toLocaleString()}\n`
      embed.setDescription(`${titleField}Are you sure want to link this account?`)
      if (res.clan) {
        thumbClan = res.clan.badgeUrls.medium
        const role = this.client.parseClanRole(res.role)
        embed.setFooter(`${role} of ${res.clan.name}\n(${res.clan.tag})`, thumbClan)
      } else {
        thumbClan = _.replace(this.client.config.emojis.thumbnail, '{0}', 'noclan.png')
        embed.setFooter('Player is clanless', thumbClan)
      }
      let dataUsr = await this.client.dbUsr.find({ 'account.playertag': tag }).select({ uid: 1 }).lean()
      const member = this.message.guild.members.cache.get(dataUsr.length > 0 ? dataUsr[0].uid : user)
      if (dataUsr.length) {
        embed.setDescription(`${titleField}Already linked to **${member.user.tag}**.`)
        return this.message.util.send(embed)
      } else {
        const msg = await this.message.util.send(null, embed)
        await msg.react('✅')
        await msg.react('❎')
        try {
          const filter = (reaction, user) => {
            return _.includes(['✅', '❎'], reaction.emoji.name) && user.id === this.message.author.id
          }
          let reaction = await msg.awaitReactions(filter, { max: 1, time: 60000, errors: ['time'] })
          reaction = reaction.first()
          await msg.reactions.removeAll()
          if (reaction.emoji.name === '❎') {
            embed.setDescription(`${titleField}Operation canceled.`)
            return msg.edit(embed)
          } else {
            let role = this.message.guild.roles.cache.find(r => r.name === 'Entry')
            await member.roles.remove(role)
            dataUsr = await this.client.dbUsr.findOneAndUpdate({ uid: user }, {
              $push: { account: { playertag: tag, date: moment().unix() } }
            }, { upsert: true, new: true })
            if (dataUsr.account.length === 1) {
              if (res.clan && _.includes(this.client.config.clanTag, res.clan.tag)) {
                role = this.message.guild.roles.cache.find(r => r.name === res.clan.name)
                await member.roles.add(role)
                if (res.role === 'leader') {
                  role = this.message.guild.roles.cache.find(r => r.name === 'Leader')
                } else if (res.role === 'coLeader') {
                  role = this.message.guild.roles.cache.find(r => r.name === 'Co-Leaders')
                } else if (res.role === 'admin') {
                  role = this.message.guild.roles.cache.find(r => r.name === 'Elders')
                } else {
                  role = this.message.guild.roles.cache.find(r => r.name === 'Members')
                }
                await member.roles.add(role)
                await member.setNickname(res.name)
              } else {
                role = this.message.guild.roles.cache.find(r => r.name === 'Approved')
                await member.roles.add(role)
                await member.setNickname(`TH ${res.townHallLevel} - ${res.name}`)
              }
            }
            embed.setDescription(`${titleField}Linked to **${member.user.tag}**.`)
            return msg.edit(embed)
          }
        } catch (e) {
          //console.trace(e)
          await msg.reactions.removeAll()
          embed.setDescription(`${titleField}No answer after 60 seconds, operation canceled.`)
          return msg.edit(embed)
        }
      }
    } catch (e) {
      await this.client.errorHandle(this.message, e)
      return this.link(tag, user)
    }
  }
}