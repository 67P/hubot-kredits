const util = require('util');
const fetch = require('node-fetch');
const groupArray = require('group-array');

module.exports = async function(robot, kredits) {

  function messageRoom(message) {
    robot.messageRoom(process.env.KREDITS_ROOM, message);
  }

  robot.logger.debug('[hubot-kredits] Loading MediaWiki integration...')

  const Contributor = kredits.Contributor;
  const Operator = kredits.Operator;

  const apiURL =  process.env.KREDITS_MEDIAWIKI_URL + 'api.php';

  function getContributorByWikiUser(username) {
    return Contributor.all().then(contributors => {
      let contrib = contributors.find(c => {
        if (typeof c.accounts !== 'object') { return false; }
        return c.accounts.find(a => {
          a.url === `${process.env.KREDITS_MEDIAWIKI_URL}User:${username}`;
        });
      });
      if (!contrib) {
        throw new Error();
      } else {
        return contrib;
      }
    });
  }

  function createProposal(username, amount, description, url, details={}) {
    return getContributorByWikiUser(username).then(contributor => {
      robot.logger.debug(`[hubot-kredits] Creating proposal to issue ${amount}₭S to ${contributor.name} for ${url}...`);

      let contribution = {
        contributorId: contributor.id,
        amount: amount,
        contributorIpfsHash: contributor.ipfsHash,
        url,
        description,
        details,
        kind: 'docs'
      };

      return Operator.addProposal(contribution).catch(error => {
        robot.logger.error(`[hubot-kredits] Adding proposal failed:`, error);
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
    return groupArray(changes, 'user');
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

  function createProposals (changes) {
    let promises = [];

    Object.keys(changes).forEach(user => {
      promises.push(createProposalForUserChanges(user, changes[user]));
    });

    return Promise.all(promises);
  }

  function pageTitlesFromChanges(changes) {
    return changes.map(c => `"${c.title}"`).join(', ');
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

  function createProposalForUserChanges (user, changes) {
    const details = analyzeUserChanges(user, changes);
    const amount = calculateAmountForChanges(changes);

    let desc = `Added ${details.charsAdded} characters of text.`;
    if (details.pagesChanged.length > 0) {
      desc = `Edited ${pageTitlesFromChanges(details.pagesChanged)}. ${desc}`;
    }
    if (details.pagesCreated.length > 0) {
      desc = `Created ${pageTitlesFromChanges(details.pagesCreated)}. ${desc}`;
    }

    let url;
    if (changes.length > 1) {
      url = `https://wiki.kosmos.org/Special:Contributions/${user}?hideMinor=1`;
    } else {
      rc = changes[0];
      url = `https://wiki.kosmos.org/index.php?title=${rc.title}&diff=${rc.revid}&oldid=${rc.old_revid}`;
    }

    return createProposal(user, amount, desc, url, details);
  }

  fetchChanges()
    .then(res => groupChangesByUser(res))
    .then(res => createProposals(res));

};
