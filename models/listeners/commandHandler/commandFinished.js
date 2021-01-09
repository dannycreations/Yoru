'use strict'
const { Listener } = require('discord-akairo')

module.exports = class CommandFinishedListener extends Listener {
  constructor() {
    super('commandFinished', {
      event: 'commandFinished',
      emitter: 'commandHandler'
    })
  }
  
  async exec(message) {
    this.client.output(`${message.author.tag}: ${message.content}`)
  }
}