const Client = require('./../client')

class SearchDiscord extends Client {
  async run(message, args) {
    try {
      
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
}

module.exports = new SearchDiscord()