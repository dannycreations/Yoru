const client = require('./../index.model.js')

class SearchModel extends client.IndexModel {
  constructor() {
    super()
  }
  
  async run(message, args) {
    try {
      
    } catch(err) {
      this.errorHandle(message, err)
    }
  }
}

module.exports = new SearchModel()