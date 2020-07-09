const client = require('./../index.model.js');

class LinkModel extends client.IndexModel {
  constructor() {
    super();
    this.protect = [];
  }
  
  async run(message, args) {
    if (!message.member.roles.cache.some(role => role.name === 'Manager') && message.author.id !== this.config.authorid) return;
    if (typeof args[2] !== 'undefined') return;
    if ([args[0], args[1]].includes(undefined)) return;
    const mention = args[1].match(/^<@!?(\d+)>$/);
    if (mention) {
      this.link(message, args[0], mention[1]);
    } else {
      if (message.author.id !== this.config.authorid) return;
      this.link(message, args[0], args[1]);
    }
  }
  
  async link(message, tag, user) {
    try {
      if (this.protect.find(arr => arr === message.author.id)) {
        return message.channel.send('You must complete previous operation before create new one');
      }
      this.protect.push(message.author.id);
      let thumb_league, thumb_clan;
      const res = await this.cclient.playerByTag(tag.toUpperCase());
      const embed = new this.discord.MessageEmbed();
      embed.setColor('#0099ff');
      if (res.league) thumb_league = res.league.iconUrls.medium;
      else thumb_league = this.emoji.thumbnails.replace('{0}', 'noleague.png');
      embed.setAuthor(`${res.name} (${res.tag})`, thumb_league);
      embed.setThumbnail(this.emoji.thumbnails.replace('{0}', `townhall-${res.townHallLevel}.png`));
      const titlefield = `${this.emoji.level} ${res.expLevel} ${this.emoji.trophies} ${this.numberWithCommas(res.trophies)} ${this.emoji.attackwin} ${this.numberWithCommas(res.attackWins)}`;
      embed.addField(titlefield, 'Are you sure you want to link this account?');
      if (res.clan) {
        thumb_clan = res.clan.badgeUrls.medium;
        const role = this.parseClanRole(res.role);
        embed.setFooter(`${role} of ${res.clan.name}\n(${res.clan.tag})`, thumb_clan);
      } else {
        thumb_clan = this.emoji.thumbnails.replace('{0}', 'noclan.png');
        embed.setFooter('Player is clanless', thumb_clan);
      }
      let check = await this.mongoRead({
        'accounts.playertag': tag
      });
      if (check.length > 0) {
        const members = message.guild.members.cache.get(check[0].userid.toString());
        await message.channel.send(`**${tag}**, Already linked to **${members.user.tag}**`);
      } else {
        const msg = await message.channel.send(embed);
        const members = message.guild.members.cache.get(user);
        await msg.react('✅');
        await msg.react('❎');
        const filter = (reaction, user) => {
          return ['✅', '❎'].includes(reaction.emoji.name) && user.id === message.author.id;
        };
        await msg.awaitReactions(filter, {
          max: 1,
          time: 60000,
          errors: ['time']
        }).then(async collected => {
          const reaction = collected.first();
          await msg.reactions.removeAll();
          if (reaction.emoji.name === '❎') {
            embed.fields = [];
            embed.addField(titlefield, 'Operation canceled');
            msg.edit(embed);
          } else {
            let role = message.guild.roles.cache.find(role => role.name === 'Entry');
            await members.roles.remove(role);
            check = await this.mongoRead({
              userid: user
            });
            if (!check.length > 0) {
              await this.mongoCreate({
                userid: user,
                accounts: {
                  playertag: tag,
                  date: Math.floor(Date.now() / 1000)
                }
              });
              if (res.clan && res.clan.tag === this.config.clantag) {
                if (res.role === 'leader') {
                  role = message.guild.roles.cache.find(role => role.name === 'Leader');
                  await members.roles.add(role);
                  await members.setNickname(`Lead - ${res.name}`);
                } else if (res.role === 'coLeader') {
                  role = message.guild.roles.cache.find(role => role.name === 'Co-Leaders');
                  await members.roles.add(role);
                  await members.setNickname(`Co - ${res.name}`);
                } else if (res.role === 'admin') {
                  role = message.guild.roles.cache.find(role => role.name === 'Elders');
                  await members.roles.add(role);
                  await members.setNickname(`Eld - ${res.name}`);
                } else {
                  role = message.guild.roles.cache.find(role => role.name === 'Members');
                  await members.roles.add(role);
                  await members.setNickname(`Mem - ${res.name}`);
                }
              } else {
                role = message.guild.roles.cache.find(role => role.name === 'Approved');
                await members.roles.add(role);
                await members.setNickname(`TH ${res.townHallLevel} - ${res.name}`);
              }
            } else {
              await this.mongoUpdate({
                userid: user
              }, {
                $push: {
                  accounts: {
                    playertag: tag,
                    date: Math.floor(Date.now() / 1000)
                  }
                }
              });
            }
            embed.fields = [];
            embed.addField(titlefield, `Linked to **${members.user.tag}**`);
            msg.edit(embed);
          }
        }).catch(async err => {
          await msg.reactions.removeAll();
          embed.fields = [];
          embed.addField(titlefield, 'No answer after 60 seconds, operation canceled');
          msg.edit(embed);
        });
      }
      this.deleteProtect(this.protect, message.author.id);
    } catch(err) {
      this.deleteProtect(this.protect, message.author.id);
      this.errorHandle(message, err);
    }
  }
}

module.exports = new LinkModel();