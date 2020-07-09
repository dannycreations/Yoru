const client = require('./model/index.model.js');
const tools = require('./model/discord/repo.model.js');

class Index extends client.IndexModel {
  constructor() {
    super();
  }
  
  async run() {
    this.dclient.on('ready', () => {
      this.output(`Bot has started, ${this.dclient.users.cache.size} users, ${this.dclient.channels.cache.size} channels, ${this.dclient.guilds.cache.size} guilds.`);
    });
    this.dclient.on('message', async message => {
      if (!message.content.startsWith(this.config.prefix) || message.author.bot) return;
      const args = message.content.slice(this.config.prefix.length).trim().split(' ');
      const command = args.shift().toLowerCase();
      if (message.author.id !== this.config.authorid) {
        return message.channel.send('❌ Under Development Mode')
      }
      if (['ping', 'p'].includes(command)) {
        const msg = await message.channel.send('Ping?');
        msg.edit(`Pong! Latency is ${msg.createdTimestamp - message.createdTimestamp}ms. API Latency is ${Math.round(this.dclient.ws.ping)}ms`);
      } else if (['check', 'c'].includes(command)) {
        tools.check.run(message, args);
      } else if (['link', 'l'].includes(command)) {
        tools.link.run(message, args);
      }
    });
    this.dclient.login(this.config.discord);
  }
}

(() => {
  const index = new Index();
  index.run();
})();