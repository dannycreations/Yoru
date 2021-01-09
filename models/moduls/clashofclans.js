const got = require('got')
const _ = require('lodash')

module.exports = class DevApiModul {
  constructor({ email, password }) {
    this.email = email
    this.password = password
  }
  
  async send(userOptions) {
    let options = _.defaultsDeep(userOptions, {
      prefixUrl: 'https://developer.clashofclans.com/',
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mi 5X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.127 Mobile Safari/537.36',
        'Content-Type': 'application/json'
      },
      responseType: 'json',
      timeout: 60000,
      retry: { limit: 0 }
    })
    if (this.logged && this.logged.cookie) {
      options.headers['Cookie'] = this.logged.cookie
    }
    const res = await got(options)
    return res.statusCode === 200 ? res : null
  }
  
  async login() {
    const ip = await got('https://ipv4bot.whatismyipaddress.com')
    const res = await this.send({
      url: 'api/login',
      json: {
        email: this.email,
        password: this.password
      }
    })
    let cookies = [
      `game-api-url=${res.body.swaggerUrl}`,
      `game-api-token=${res.body.temporaryAPIToken}`
    ]
    for (const cookie of res.headers['set-cookie']) {
      cookies.push(_.split(cookie, /\s+/)[0])
    }
    this.logged = { cookie: cookies.join(';'), ip: ip.body }
  }
  
  async logout() {
    await this.send({ url: 'api/logout' })
    this.logged = null
  }
  
  async list() {
    const { body } = await this.send({ url: 'api/apikey/list' })
    return _.map(body.keys, r => r.id)
  }
  
  async create() {
    const { body } = await this.send({
      url: 'api/apikey/create',
      json: {
        name: 'Hey',
        description: 'Tayo',
        cidrRanges: [this.logged.ip],
        scopes: null
      }
    })
    return body.key
  }
  
  async revoke(id) {
    return this.send({
      url: 'api/apikey/revoke',
      json: { id: id }
    })
  }
  
  async cleanKeys() {
    const listKeys = await this.list()
    for (const id of listKeys) {
      await this.revoke(id)
    }
  }
}