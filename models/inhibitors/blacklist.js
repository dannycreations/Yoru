'use strict'
const { Inhibitor } = require('discord-akairo')

module.exports = class BlacklistInhibitor extends Inhibitor {
  constructor() {
    super('blacklist', {
      reason: 'blacklist'
    })
  }
  
  async exec(message) {
    if (this.client.ownerOnly && message.author.id !== this.client.config.ownerId) {
      return message.util.send('⚠️ Under Maintenance')
    }
  }
}