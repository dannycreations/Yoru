'use strict'
const { Listener } = require('discord-akairo')

module.exports = class UnhandledRejectionListener extends Listener {
  constructor() {
    super('unhandledRejection', {
      event: 'unhandledRejection',
      emitter: 'processHandler'
    })
  }
  
  exec(error) {
    console.error(error)
  }
}