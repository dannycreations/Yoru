const client = require('./../index.model.js');

class SearchModel extends client.IndexModel {
  constructor() {
    super();
  }
  
  async run(message, args) {
    
  }
}

module.exports = new SearchModel();