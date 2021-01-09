'use strict'
const _ = require('lodash')
const chalk = require('chalk')
const { Listener } = require('discord-akairo')

module.exports = class ReadyListener extends Listener {
  constructor() {
    super('ready', {
      event: 'ready',
      emitter: 'client',
      type: 'once'
    })
  }
    
  async exec() {
    this.watermark()
    this.client.output(`Bot has started, ${this.client.users.cache.size} users, ${this.client.channels.cache.size} channels, ${this.client.guilds.cache.size} guilds.`)
    this.client.user.setPresence({ status: 'idle', activity: { name: 'Clash of Clans', type: 'PLAYING' } })
  }
  
  watermark() {
    const data = 'ICAgICAgXyAgICAgICAgICAgICAgICAgIF8KICAgICB8IHwgICAgICAgICAgICAgICAgfCB8CiAgIF9ffCB8XyBfXyAgXyAgIF8gIF9fX3wgfF8gX19fCiAgLyBfJyB8ICdfIFxcfCB8IHwgfC8gX198IF9fLyBfX3wKIHwgfF98IHwgfCB8IHwgfF98IHwgfF9ffCB8X1xcX18gXAogIFxcX18sX3xffCB8X3xcXF9fLCB8XFxfX198XFxfX3xfX18vCiAgICAgICAgICAgICAgIF9fLyB8CiAgICAgICAgICAgICAgfF9fXy8'
    console.log(chalk`{bold.green ${_.join(_.split(Buffer.from(data, 'base64').toString(), '\\\\'), '\\')}\n}`)
  }
}