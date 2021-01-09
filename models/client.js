'use strict'
const fs = require('fs')
const delay = require('delay')
const moment = require('moment')
const { Collection } = require('discord.js')
const clashApi = require('clash-of-clans-api')
const { dbUsr } = require('./moduls/mongoose')
const clashDev = require('./moduls/clashofclans')
const CronJobManager = require('cron-job-manager')
const dirConfig = `${process.cwd()}/models/settings/config.json`
const dataConfig = JSON.parse(fs.readFileSync(dirConfig))
const {
  AkairoClient,
  CommandHandler,
  InhibitorHandler,
  ListenerHandler
} = require('discord-akairo')

class Client extends AkairoClient {
  constructor() {
    super({}, {
      fetchAllMembers: true,
      messageCacheMaxSize: 10e3,
      messageCacheLifetime: 3600
    })
    this.dbUsr = dbUsr
    this.config = dataConfig
    this.ownerOnly = false
  }
  
  output(msg = '', inline = false) {
    const time = `| ${moment().format('HH:mm:ss')} | `
    process.stdout.clearLine()
    process.stdout.cursorTo(0)
    process.stdout.write('\x1B[?25l')
    if (!inline) console.log(`${time}${msg}`)
    else process.stdout.write(`${time}${msg}`)
  }
  
  async errorHandle(message, e) {
    if (e.statusCode >= 500 && e.statusCode <= 521) {
      return this.output(`${e.response.statusCode} ${e.response.statusMessage}`)
    } else if (e.statusCode === 403) {
      this.output(e.message)
      return this.refreshKey()
    } else if (message && e.statusCode === 404) {
      const field = `> ${message.content}\nError, Player tag not found.`
      return message.util.send(field)
    } else if (e.error) {
      this.output(e.error.code)
      return delay(10000)
    }
    console.trace(e.response ? e.response : e)
    process.exit()
  }
  
  start() {
    this.runJob = new CronJobManager()
    this.ownerID = this.config.ownerId
    this.commandHandler = new CommandHandler(this, {
      directory: `${process.cwd()}/models/commands`,
      automateCategories: true,
      prefix: this.config.prefix,
      allowMention: true,
      handleEdits: true,
      commandUtil: true,
      defaultCooldown: 3000
    })
    this.inhibitorHandler = new InhibitorHandler(this, {
      directory: `${process.cwd()}/models/inhibitors`,
      automateCategories: true
    })
    this.listenerHandler = new ListenerHandler(this, {
      directory: `${process.cwd()}/models/listeners`,
      automateCategories: true
    })
    this.commandHandler.useInhibitorHandler(this.inhibitorHandler)
    this.commandHandler.useListenerHandler(this.listenerHandler)
    this.listenerHandler.setEmitters({
      processHandler: process,
      commandHandler: this.commandHandler,
      inhibitorHandler: this.inhibitorHandler,
      listenerHandler: this.listenerHandler
    })
    this.commandHandler.loadAll()
    this.inhibitorHandler.loadAll()
    this.listenerHandler.loadAll()
    return this.login(this.config['discordToken'])
  }
  
  get clashApi() {
    return clashApi({
      token: this.config['clashToken'],
      requrest: { timeout: 30000 }
    })
  }
  
  parseClanRole(role) {
    if (role === 'leader') return 'Leader'
    else if (role === 'coLeader') return 'Co-Leader'
    else if (role === 'admin') return 'Elder'
    else return 'Member'
  }
  
  async refreshKey() {
    try {
      const clashdev = new clashDev({
        email: this.config.clashDevEmail,
        password: this.config.clashDevPassword
      })
      await clashdev.login()
      await clashdev.cleanKeys()
      const create = await clashdev.create()
      this.config['clashToken'] = create.key
      fs.writeFileSync(dirConfig, JSON.stringify(this.config, null, 2))
    } catch (e) {
      return this.errorHandle(null, e)
    }
  }
}

module.exports = new Client()