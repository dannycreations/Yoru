const _ = require('lodash')
const chalk = require('chalk')
const Client = require('./model/client')
const Discord = require('./model/discord/index.discord')

class Index extends Client {
  async run() {
    this.dclient.once('ready', () => {
      this.watermark()
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
      const args = _.split(_.trim(message.content.slice(this.dconfig.prefix.length)), ' ')
      const command = args.shift().toLowerCase()
      if (_.isNil(command) || _.includes(command, this.dconfig.prefix)) return
      if (command === 'ping') {
        const msg = await message.channel.send('Ping?')
        msg.edit(`Pong! Latency is ${msg.createdTimestamp - message.createdTimestamp}ms. API Latency is ${Math.round(this.dclient.ws.ping)}ms`)
      } else if (_.includes(['check', 'c'], command)) {
        Discord.check.run(message, args)
      } else if (_.includes(['link', 'l'], command)) {
        Discord.link.run(message, args)
      } else if (_.includes(['search', 's'], command)) {
        Discord.search.run(message, args)
      }
    })
    this.dclient.login(this.dconfig['discord-token'])
  }
  
  watermark() {
    const data = 'ICAgICAgXyAgICAgICAgICAgICAgICAgIF8KICAgICB8IHwgICAgICAgICAgICAgICAgfCB8CiAgIF9ffCB8XyBfXyAgXyAgIF8gIF9fX3wgfF8gX19fCiAgLyBfJyB8ICdfIFxcfCB8IHwgfC8gX198IF9fLyBfX3wKIHwgfF98IHwgfCB8IHwgfF98IHwgfF9ffCB8X1xcX18gXAogIFxcX18sX3xffCB8X3xcXF9fLCB8XFxfX198XFxfX3xfX18vCiAgICAgICAgICAgICAgIF9fLyB8CiAgICAgICAgICAgICAgfF9fXy8'
    console.log(chalk`{bold.green ${_.join(_.split(Buffer.from(data, 'base64').toString(), '\\\\'), '\\')}\n}`)
  }
}

(() => {
  const index = new Index()
  index.run()
})()