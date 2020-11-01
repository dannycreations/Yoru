const fs = require('fs')
const moment = require('moment')
const discord = require('discord.js')
const clash = require('clash-of-clans-api')

const { dbUsr } = require('./moduls/mongoose.modul')
const clashdev = require('./moduls/clashofclans.modul')

module.exports = class Client {
  constructor() {
    this.dbUsr = dbUsr
    this.discord = discord
    this.dclient = new discord.Client()
    this.dconfig = require('./discord/others/config.json')
    this.cclient = clash({ token: this.dconfig['clash-token'] })
  }
  
  async errorHandle(message, err) {
    if (err.statusCode === 403) {
      return this.refreshKey(message)
    } else if (err.statusCode === 404) {
      const field = `> ${message.content}\nError, Tag not found.`
      return message.channel.send(field)
    }
    console.error(err)
    const field = '```Name: ' + err.message + '```'
    message.channel.send(field)
  }
  
  output(msg = '') {
    console.log(`| ${moment().format('HH:mm:ss')} | ${msg}`)
  }
  
  parseClanRole(role) {
    if (role === 'leader') return 'Leader'
    else if (role === 'coLeader') return 'Co-Leader'
    else if (role === 'admin') return 'Elder'
    else return 'Member'
  }
  
  async refreshKey(message) {
    try {
      await clashdev.login()
      const list = await clashdev.list()
      for (const key of list) {
        await clashdev.revoke(key.id)
      }
      const create = await clashdev.create()
      await clashdev.logout()
      const filePath = `${process.cwd()}/model/discord/others/config.json`
      let readfile = JSON.parse(fs.readFileSync(filePath))
      readfile['clash-token'] = create.key, this.dconfig = readfile
      fs.writeFileSync(filePath, JSON.stringify(readfile, null, 2))
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
}