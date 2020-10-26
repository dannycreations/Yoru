const fs = require('fs')
const _ = require('lodash')
const path = require('path')
const chalk = require('chalk')
const moment = require('moment')
const discord = require('discord.js')
const clash = require('clash-of-clans-api')

const mongo = require('./moduls/mongoose.js')
const clashdev = require('./moduls/clashofclans.js')
const demoji = require('./discord/others/emojis.json')
const dconfig = require('./discord/others/configs.json')

const dclient = new discord.Client()
const cclient = clash({ token: dconfig.clash })

class IndexModel {
  constructor() {
    this._ = _
    this.fs = fs
    this.path = path
    this.chalk = chalk
    this.moment = moment
    this.cclient = cclient
    this.clashdev = clashdev
    
    this.demoji = demoji
    this.dconfig = dconfig
    this.discord = discord
    this.dclient = dclient
    
    this.dbUsr = mongo.client.model('user', mongo.schemaUsr)
  }
  
  async errorHandle(message, err) {
    if (err.statusCode === 403) {
      return this.refreshKey(message)
    } else if (err.statusCode === 404) {
      const field = `> ${message.content}\nError, Tag not found.`
      return message.channel.send(field)
    }
    console.log(err)
    const field = '```Name: ' + err.message + '```'
    message.channel.send(field)
  }
  
  output(msg = '') {
    console.log(`| ${this.moment().format('HH:mm:ss')} | ${msg}`)
  }
  
  parseClanRole(role) {
    if (role === 'leader') return 'Leader'
    else if (role === 'coLeader') return 'Co-Leader'
    else if (role === 'admin') return 'Elder'
    else return 'Member'
  }
  
  async refreshKey(message) {
    try {
      await this.clashdev.login()
      const list = await this.clashdev.list()
      for (const key of list) {
        await this.clashdev.revoke(key.id)
      }
      const create = await this.clashdev.create()
      const filePath = this.path.join(`${process.cwd()}/model/discord/others/configs.json`)
      let readfile = JSON.parse(this.fs.readFileSync(filePath))
      readfile.clash = create.key
      this.fs.writeFileSync(filePath, JSON.stringify(readfile, null, 2), { flag: 'w' })
      this.clashdev.logout()
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
}

exports.IndexModel = IndexModel