const got = require('got')
const _ = require('lodash')

class DeveloperAPI {
  constructor() {
    this.email = 'your-developer-email'
    this.password = 'your-developer-password'
    
    this.logged = false
  }
  
  async send(userOptions) {
    let options = _.defaultsDeep(userOptions, {
      prefixUrl: 'https://developer.clashofclans.com/api/',
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mi 5X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.127 Mobile Safari/537.36',
        'Content-Type': 'application/json'
      },
      json: {},
      responseType: 'json',
      timeout: 60000,
      retry: { limit: 0 }
    })
    if (_.isString(this.logged.cookie)) {
      options.headers['Cookie'] = this.logged.cookie
    }
    const res = await got(options)
    return res.statusCode === 200 ? res : false
  }
  
  async login() {
    const ip = await got('https://ipv4bot.whatismyipaddress.com')
    const res = await this.send({
      url: 'login',
      json: {
        email: this.email,
        password: this.password
      }
    })
    let cookies = ''
    for (const cookie of res.headers['set-cookie']) {
      cookies += `${_.split(cookie, ' ')[0]}`
    }
    cookies += `game-api-url=${res.body.swaggerUrl};`
    cookies += `game-api-token=${res.body.temporaryAPIToken};`
    this.logged = { cookie: cookies, ip: ip.body }
  }
  
  async logout(cookie) {
    this.send({ url: 'logout' })
  }
  
  async list(cookie) {
    const res = await this.send({ url: 'apikey/list' })
    return res.body.keys
  }
  
  async create() {
    const res = await this.send({
      url: 'apikey/create',
      json: {
        name: 'Hey',
        description: 'Tayo',
        cidrRanges: [this.logged.ip],
        scopes: null
      }
    })
    return res.body.key
  }
  
  async revoke(id, cookie) {
    this.send({
      url: 'apikey/revoke',
      json: { id: id }
    })
  }
}

module.exports = new DeveloperAPI()