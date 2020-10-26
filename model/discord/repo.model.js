class RepoModel {
  constructor() {
    this.check = require('./check.model.js')
    this.link = require('./link.model.js')
    this.search = require('./search.model.js')
  }
}

module.exports = new RepoModel()