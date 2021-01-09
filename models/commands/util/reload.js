'use strict'
const { Command } = require('discord-akairo')

module.exports = class ReloadCommand extends Command {
  constructor() {
    super('reload', {
      aliases: ['reload'],
      description: {
        content: 'Reloads all commands, inhibitors, listeners.',
        ownerOnly: true
      },
      ownerOnly: true
    })
  }
  
  async exec(message) {
    await this.client.commandHandler.reloadAll()
    this.client.output(`Commands reloaded: ${this.client.commandHandler.modules.size}`)
    await this.client.inhibitorHandler.reloadAll()
    this.client.output(`Inhibitors reloaded: ${this.client.inhibitorHandler.modules.size}`)
    await this.client.listenerHandler.reloadAll()
    this.client.output(`Listeners reloaded: ${this.client.listenerHandler.modules.size}`)
    return message.util.send('Sucessfully reloaded.').then(msg => {
      if (msg.deletable && !msg.deleted) msg.delete({ timeout: 3000 })
      if (message.deletable && !message.deleted) message.delete({ timeout: 3000 })
    })
  }
}