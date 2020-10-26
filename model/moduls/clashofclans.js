let got = require('got')

got = got.extend({ timeout: 60000, retry: { limit: 0 } })

class DeveloperAPI {
  constructor() {
    this.got = got
    this.email = ''
    this.password = ''
    
    this.logged = false
    this.headers = {
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; Mi 5X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.127 Mobile Safari/537.36',
      'content-type': 'application/json'
    }
  }
  
  async login() {
    const ip = await this.got.get('https://ipv4bot.whatismyipaddress.com')
    const res = await this.got.post('https://developer.clashofclans.com/api/login', {
      headers: this.headers,
      json: { email: this.email, password: this.password },
      responseType: 'json'
    })
    if (res.statusCode === 200) {
      let cookies = ''
      for (const cookie of res.headers['set-cookie']) {
        cookies += `${cookie.split(' ')[0]}`
      }
      cookies += `game-api-url=${res.body.swaggerUrl};`
      cookies += `game-api-token=${res.body.temporaryAPIToken};`
      this.headers['cookie'] = cookies
      this.logged = { ip: ip.body }
    }
  }
  
  async logout() {
    const res = await this.got.post('https://developer.clashofclans.com/api/logout', {
      headers: this.headers,
      json: {},
      responseType: 'json'
    })
    return res.statusCode === 200 ? true : false
  }
  
  async list() {
    const res = await this.got.post('https://developer.clashofclans.com/api/apikey/list', {
      headers: this.headers,
      json: {},
      responseType: 'json'
    })
    return res.statusCode === 200 ? res.body.keys : false
  }
  
  async create() {
    const res = await this.got.post('https://developer.clashofclans.com/api/apikey/create', {
      headers: this.headers,
      json: {
        name: 'Hey',
        description: 'Tayo',
        cidrRanges: [this.logged.ip],
        scopes: null
      },
      responseType: 'json'
    })
    return res.statusCode === 200 ? res.body.key : false
  }
  
  async revoke(id) {
    const res = await this.got.post('https://developer.clashofclans.com/api/apikey/revoke', {
      headers: this.headers,
      json: { id: id },
      responseType: 'json'
    })
    return res.statusCode === 200 ? true : false
  }
}

module.exports = new DeveloperAPI()