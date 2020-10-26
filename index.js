const client = require('./model/index.model.js')
const tools = require('./model/discord/repo.model.js')

class Index extends client.IndexModel {
  constructor() {
    super()
  }
  
  async run() {
    this.dclient.once('ready', () => {
      this.output(`Bot has started, ${this.dclient.users.cache.size} users, ${this.dclient.channels.cache.size} channels, ${this.dclient.guilds.cache.size} guilds.`)
      this.dclient.user.setPresence({
        status: 'idle',
        activity: {
          name: 'Clash of Clans',
          type: 'PLAYING'
        }
      })
    })
    this.dclient.on('message', async message => {
      if (!message.content.startsWith(this.dconfig.prefix) || message.author.bot) return
      const args = message.content.slice(this.dconfig.prefix.length).trim().split(' ')
      const command = args.shift().toLowerCase()
      if (!command || command.includes(this.dconfig.prefix)) return
      if (['ping'].includes(command)) {
        const msg = await message.channel.send('Ping?')
        msg.edit(`Pong! Latency is ${msg.createdTimestamp - message.createdTimestamp}ms. API Latency is ${Math.round(this.dclient.ws.ping)}ms`)
      } else if (['check', 'c'].includes(command)) {
        tools.check.run(message, args)
      } else if (['link', 'l'].includes(command)) {
        tools.link.run(message, args)
      } else if (['search', 's'].includes(command)) {
        tools.search.run(message, args)
      }
    })
    this.dclient.login(this.dconfig.discord)
  }
}

(() => {
  const index = new Index()
  index.run()
})()