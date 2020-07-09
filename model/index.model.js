const chalk = require('chalk');
let mongoose = require('mongoose');
const discord = require('discord.js');
const dateformat = require('dateformat');
let clash = require('clash-of-clans-api');

const emojis = require('./discord/others/emojis.json');
const configs = require('./discord/others/configs.json');

mongoose.connect('mongodb://localhost:27017/xfarmer2', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useFindAndModify: false
});
const schemaDefault = new mongoose.Schema({
  userid: String,
  accounts: [{
    playertag: String,
    date: Number
  }]
});

class IndexModel {
  constructor() {
    this.chalk = chalk;
    this.cclient = clash({
      token: configs.clash
    });
    this.dateformat = dateformat;
    
    this.emoji = emojis;
    this.config = configs;
    this.discord = discord;
    this.dclient = new discord.Client();
    
    this.mongo = mongoose.model('users', schemaDefault);
  }
  
  output(msg) {
    console.log(`| ${this.dateformat(new Date(), 'HH:MM:ss')} | ${msg}`);
  }
  
  numberWithCommas(number) {
    return number.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ',');
  }
  
  async errorHandle(message, err) {
    if (err.statusCode === 404) {
      return message.channel.send('Error, Tag not found')
    }
    let field = '';
    field += '```Name: ' + err.message + '```';
    message.channel.send(field);
    console.trace(err);
  }
  
  parseClanRole(role) {
    if (role === 'leader') {
      return 'Leader';
    } else if (role === 'coLeader') {
      return 'Co-Leader';
    } else if (role === 'admin') {
      return 'Elder';
    } else {
      return 'Member';
    }
  }
  
  deleteProtect(array, value) {
    let i = 0;
    while (i < array.length) {
      if (array[i] === value) array.splice(i, 1);
      else i++;
    }
    return array;
  }
  
  mongoCreate(data) {
    new this.mongo(data).save();
  }
  
  mongoRead(query) {
    return this.mongo.find(query, (err, data) => {
      return data;
    }).exec();
  }
  
  mongoUpdate(query, data) {
    this.mongo.findOneAndUpdate(query, data).exec();
  }
}

exports.IndexModel = IndexModel;