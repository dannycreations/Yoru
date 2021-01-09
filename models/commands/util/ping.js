'use strict'
const { Command } = require('discord-akairo')

module.exports = class PingCommand extends Command {
  constructor() {
    super('ping', {
      aliases: ['ping'],
      description: {
        content: 'Gets the bot\'s latency and heartbeat.'
      }
    })
  }
  
  async exec(message) {
    const msg = await message.util.send('Ping?')
    const timeDiff = (msg.editedAt || msg.createdAt) - (message.editedAt || message.createdAt)
    return message.util.send([
      '🏓 **Pong!**',
      `🔂 **RTT**: ${timeDiff} ms`,
      `💟 **Heartbeat**: ${Math.round(this.client.ws.ping)} ms`
    ])
  }
}