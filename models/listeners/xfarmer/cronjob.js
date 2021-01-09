'use strict'
const fs = require('fs')
const _ = require('lodash')
const { Listener } = require('discord-akairo')

module.exports = class CronjobListener extends Listener {
  constructor() {
    super('cronjob', {
      event: 'ready',
      emitter: 'client',
      type: 'once'
    })
  }
    
  exec() {
    this.fetchServer()
  }
  
  fetchServer() {
    return
    this.client.runJob.add('fetchServer', '0 */1 * * * *', async () => {
      try {
        for (const clan of this.client.config.clanTag) {
          const members = await this.client.clashApi.clanMembersByTag(clan)
          for (const member of members.items) {
            const players = await this.client.clashApi.playerByTag(member.tag)
          }
        }
      } catch (e) {
        return this.client.errorHandle(null, e)
      }
    }, { start: true, runOnInit: true })
  }
}