const client = require('./../index.model.js');

class CheckModel extends client.IndexModel {
  constructor() {
    super();
  }
  
  async run(message, args) {
    if (typeof args[1] !== 'undefined') return;
    if (args[0].toLowerCase() === 'members') {
      this.checkMembers(message);
    } else {
      this.check(message, args[0]);
    }
  }
  
  async check(message, tag) {
    try {
      let thumb_league, thumb_clan;
      const res = await this.cclient.playerByTag(tag.toUpperCase());
      const embed = new this.discord.MessageEmbed();
      embed.setColor('#0099ff');
      embed.setTitle('Open in Clash of Clans ↗');
      embed.setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${tag.split('#')[1]}`);
      if (res.league) thumb_league = res.league.iconUrls.medium;
      else thumb_league = this.emoji.thumbnails.replace('{0}', 'noleague.png');
      embed.setAuthor(`${res.name} (${res.tag})`, thumb_league);
      embed.setThumbnail(this.emoji.thumbnails.replace('{0}', `townhall-${res.townHallLevel}.png`));
      let troops1 = '';
      let troops2 = '';
      for (let troop of res.troops) {
        if (troop.village === 'home') {
          troop = this.emoji.troops[troop.name] + '**' + troop.level + '**/' + troop.maxLevel + ' ';
          if ((troops1.length + troop.length) < 1024) troops1 += troop;
          else troops2 += troop;
        }
      }
      if (troops1) embed.addField('Troops', troops1);
      if (troops2) embed.addField('Troops 2', troops2);
      let spells = '';
      for (const spell of res.spells) {
        if (spell.village === 'home') {
          spells += this.emoji.spells[spell.name] + '**' + spell.level + '**/' + spell.maxLevel + ' ';
        }
      }
      if (spells) embed.addField('Spells', spells);
      let heroes = '';
      for (const hero of res.heroes) {
        if (hero.village === 'home') {
          heroes += this.emoji.heroes[hero.name] + '**' + hero.level + '**/' + hero.maxLevel + ' ';
        }
      }
      if (heroes) embed.addField('Heroes', heroes);
      let achievements = this.emoji.stars[res.achievements[14].stars] + ' **' + res.achievements[14].name + '** ' + this.numberWithCommas(res.achievements[14].value) + '\n';
      achievements += this.emoji.stars[res.achievements[31].stars] + ' **' + res.achievements[31].name + '** ' + this.numberWithCommas(res.achievements[31].value);
      embed.addField('Achievements', achievements);
      if (res.clan) {
        thumb_clan = res.clan.badgeUrls.medium;
        const role = this.parseClanRole(res.role);
        embed.setFooter(`${role} of ${res.clan.name}\n(${res.clan.tag})`, thumb_clan);
      } else {
        thumb_clan = this.emoji.thumbnails.replace('{0}', 'noclan.png');
        embed.setFooter('Player is clanless', thumb_clan);
      }
      message.channel.send(embed);
    } catch(err) {
      this.errorHandle(message, err);
    }
  }
  
  async checkMembers(message) {
    try {
      const res = await this.cclient.clanByTag(this.config.clantag);
      let withDiscord = 0, withDiscordStr = '';
      let withoutDiscord = 0, withoutDiscordStr = '';
      for (const data of res.memberList) {
        const check = await this.mongoRead({
          'accounts.playertag': data.tag
        });
        if (check.length > 0) {
          withDiscord++;
          withDiscordStr += `**${data.name}** ${data.tag}\n`;
        } else {
          withoutDiscord++;
          withoutDiscordStr += `**${data.name}** ${data.tag}\n`;
        }
      }
      let field = '';
      field += `👥 **Total Players in Clan:** ${res.members}\n\n`;
      field += `👍 **Players in Discord:** ${withDiscord}\n${withDiscordStr}\n`;
      field += `👎 **Players not in Discord:** ${withoutDiscord}\n${withoutDiscordStr}`;
      message.channel.send(field);
    } catch(err) {
      this.errorHandle(message, err);
    }
  }
}

module.exports = new CheckModel();