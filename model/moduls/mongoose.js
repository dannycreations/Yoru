const mongoose = require('mongoose')

mongoose.connect('mongodb://localhost:27017/xfarmer2', {
  useCreateIndex: true,
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useFindAndModify: false
})

mongoose.pluralize(null)

const customOptions = {
  schema: {
    strict: false
    //autoIndex: false
  },
  index: {
    unique: true
  }
}

const schemaUsr = new mongoose.Schema({
  uid: String,
  account: [{
    playertag: String,
    date: Number
  }]
}, customOptions.schema)

schemaUsr.index({ uid: 1, 'account.playertag': 1 }, customOptions.index)

module.exports = {
  client: mongoose,
  schemaUsr: schemaUsr
}