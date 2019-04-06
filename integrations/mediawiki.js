const url = require('url');
const util = require('util');
const fetch = require('node-fetch');
const groupArray = require('group-array');
const cron = require('node-cron');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function(robot, kredits) {

  function messageRoom(message) {
    robot.messageRoom(process.env.KREDITS_ROOM, message);
  }

  robot.logger.debug('[hubot-kredits] Loading MediaWiki integration...')

  const Contributor = kredits.Contributor;
  const Contribution = kredits.Contribution;

  const wikiURL = process.env.KREDITS_MEDIAWIKI_URL;
  const apiURL =  wikiURL + 'api.php';

  function getContributorByWikiUser(username) {
    let account = {
      site: url.parse(process.env.KREDITS_MEDIAWIKI_URL).hostname,
      username: username
    }
    return Contributor.findByAccount(account).then(contributor => {
      robot.logger.debug('CONTRIBUTOR: ', contributor)
      if (contributor) { return contributor; } else { throw new Error(); }
    });
  }

  function createContribution(username, amount, description, url, details={}) {
    return getContributorByWikiUser(username).then(contributor => {
      robot.logger.debug(`[hubot-kredits] Creating contribution token for ${amount}₭S to ${contributor.name} for ${url}...`);

      let contribution = {
        contributorId: contributor.id,
        amount: amount,
        contributorIpfsHash: contributor.ipfsHash,
        url,
        description,
        details,
        kind: 'docs'
      };

      return Contribution.addContribution(contribution).catch(error => {
        robot.logger.error(`[hubot-kredits] Adding contribution failed:`, error);
      });
    }).catch(() => {
        robot.logger.info(`[hubot-kredits] No contributor found for ${username}`);
        messageRoom(`I wanted to propose giving kredits to wiki user ${username}, but I cannot find their info. Please add them as a contributor: https://kredits.kosmos.org`);
    });
  }

  function fetchChanges () {
    const params = [
      'action=query',
      'format=json',
      'list=recentchanges',
      'rctype=edit|new',
      'rcshow=!minor|!bot|!anon|!redirect',
      'rclimit=max',
      'rcprop=ids|title|timestamp|user|sizes|comment|flags'
    ];

    let endTime = robot.brain.get('kredits:mediawiki:last_processed_at');
    if (endTime) {
      robot.logger.debug(`[hubot-kredits] Fetching wiki edits since ${endTime}`);
      params.push(`rcend=${endTime}`);
    }

    const url = `${apiURL}?${params.join('&')}`;

    return fetch(url).then(res => {
      if (res.status === 200) {
        return res.json();
      } else {
        robot.logger.info(`Fetching ${url} returned HTTP status ${res.status}:`);
        robot.logger.info(res.body);
        throw Error('Unexpected response from '+url);
      }
    }).then(res => {
      return res.query.recentchanges;
    }).catch(res => {
      robot.logger.error(`[hubot-kredits] Failed to fetch ${url} (likely due to a network issue)`);
    });
  }

  function groupChangesByUser (changes) {
    return Promise.resolve(groupArray(changes, 'user'));
  }

  function analyzeUserChanges (user, changes) {
    // robot.logger.debug(`Analyzing ${changes.length} edits from ${user} ...`);
    const results = {};

    results.pagesCreated = changes.filter(c => c.type === 'new');
    results.pagesChanged = changes.filter(c => c.type === 'edit');
    results.charsAdded = changes
      .map(c => { return (c.oldlen < c.newlen) ? (c.newlen - c.oldlen) : 0; })
      .reduce((a, b) => a + b);

    // robot.logger.debug(`Created ${results.pagesCreated.length} pages`);
    // robot.logger.debug(`Edited ${results.pagesChanged.length} pages`);
    // robot.logger.debug(`Added ${results.charsAdded} lines of text\n`);
    return results;
  }

  async function createContributions (changes) {
    let promises = [];

    for (const user of Object.keys(changes)) {
      await createContributionForUserChanges(user, changes[user]);
      await sleep(60000);
    }

    return Promise.resolve();
  }

  function pageTitlesFromChanges(changes) {
    return [...new Set(changes.map(c => `"${c.title}"`))].join(', ');
  }

  function calculateAmountForChanges(details) {
    let amount;

    if (details.charsAdded < 280) {
      // less than a tweet
      amount = 500;
    } else if (details.charsAdded < 2000) {
      amount = 1500;
    } else {
      amount = 5000;
    }

    return amount;
  }

  function createContributionForUserChanges (user, changes) {
    const details = analyzeUserChanges(user, changes);
    const amount = calculateAmountForChanges(details);

    let desc = `Added ${details.charsAdded} characters of text.`;
    if (details.pagesChanged.length > 0) {
      desc = `Edited ${pageTitlesFromChanges(details.pagesChanged)}. ${desc}`;
    }
    if (details.pagesCreated.length > 0) {
      desc = `Created ${pageTitlesFromChanges(details.pagesCreated)}. ${desc}`;
    }
    desc = `Wiki contributions: ${desc}`;

    let url;
    if (changes.length > 1) {
      url = `${wikiURL}Special:Contributions/${user}?hideMinor=1`;
    } else {
      rc = changes[0];
      url = `${wikiURL}index.php?title=${rc.title}&diff=${rc.revid}&oldid=${rc.old_revid}`;
    }

    return createContribution(user, amount, desc, url, details);
  }

  function updateTimestampForNextFetch () {
    robot.logger.debug(`[hubot-kredits] Set timestamp for wiki changes fetch`);
    robot.brain.set('kredits:mediawiki:last_processed_at', new Date().toISOString());
  }

  function processWikiChangesSinceLastRun () {
    fetchChanges()
      .then(res => groupChangesByUser(res))
      .then(res => createContributions(res))
      .then(() => updateTimestampForNextFetch());
  }

  // cron.schedule('0 7 * * *', processWikiChangesSinceLastRun);
  processWikiChangesSinceLastRun();

};
