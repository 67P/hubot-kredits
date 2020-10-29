const util = require('util');
const amountFromLabels = require('./utils/amount-from-labels');
const kindFromLabels = require('./utils/kind-from-labels');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function(robot, kredits) {

  function messageRoom(message) {
    robot.messageRoom(process.env.KREDITS_ROOM, message);
  }

  robot.logger.debug('[hubot-kredits] Loading Gitea integration...');

  let repoBlackList = [];
  if (process.env.KREDITS_GITEA_REPO_BLACKLIST) {
    repoBlackList = process.env.KREDITS_GITEA_REPO_BLACKLIST.split(',');
    robot.logger.debug('[hubot-kredits] Ignoring Gitea actions from ', util.inspect(repoBlackList));
  }

  const Contributor = kredits.Contributor;
  const Contribution = kredits.Contribution;

  function getContributorByGiteaUser(username) {
    return Contributor.all().then(contributors => {
      const contrib = contributors.find(c => {
        return c.gitea_username === username;
      });
      if (!contrib) {
        throw new Error(`No contributor found for ${username}`);
      } else {
        return contrib;
      }
    });
  }

  function createContribution(giteaUser, date, time, amount, kind, description, url, details) {
    return getContributorByGiteaUser(giteaUser).then(contributor => {
      robot.logger.debug(`[hubot-kredits] Creating contribution token for ${amount}₭S to ${giteaUser} for ${url}...`);

      const contributionAttr = {
        contributorId: contributor.id,
        contributorIpfsHash: contributor.ipfsHash,
        date,
        time,
        amount,
        kind,
        description,
        url,
        details
      };

      robot.logger.debug(`[hubot-kredits] contribution attributes:`);
      robot.logger.debug(util.inspect(contributionAttr, { depth: 1, colors: true }));

      return Contribution.add(contributionAttr).catch(error => {
        robot.logger.error(`[hubot-kredits] Error:`, error);
        messageRoom(`I tried to add a contribution for ${giteaUser} for ${url}, but I encountered an error when submitting the tx:`);
        messageRoom(error.message);
      });
    });
  }

  async function handleGiteaIssueClosed(data) {
    const issue       = data.issue;
    const repoName    = data.repository.full_name;
    const web_url     = `${data.repository.html_url}/issues/${issue.number}`;
    const description = `${repoName}: ${issue.title}`;
    const labels      = issue.labels.map(l => l.name);
    const amount      = amountFromLabels(labels);
    const kind        = kindFromLabels(labels);
    const assignees   = issue.assignees ? issue.assignees.map(a => a.login) : [];
    [ date, time ]    = issue.closed_at.split('T');

    if (amount === 0) {
      robot.logger.info('[hubot-kredits] Kredits amount from issue label is zero; ignoring');
      return Promise.resolve();
    } else if (repoBlackList.includes(repoName)) {
      robot.logger.debug(`[hubot-kredits] ${repoName} is on black list; ignoring`);
      return Promise.resolve();
    }

    let recipients;
    if (assignees.length > 0) {
      recipients = assignees;
    } else {
      recipients = [issue.user.login];
    }

    for (const recipient of recipients) {
      try {
        await createContribution(recipient, date, time, amount,
                                 kind, description, web_url,
                                 { issue, repository: data.repository });
        await sleep(60000);
      }
      catch (err) { robot.logger.error(err); }
    }

    return Promise.resolve();
  }

  async function handleGiteaPullRequestClosed(data) {
    const pull_request = data.pull_request;
    const repoName     = data.repository.full_name;
    const web_url      = pull_request.html_url;
    const description  = `${repoName}: ${pull_request.title}`;
    const labels      = pull_request.labels.map(l => l.name);
    const amount      = amountFromLabels(labels);
    const kind        = kindFromLabels(labels);
    const assignees    = pull_request.assignees ? pull_request.assignees.map(a => a.login) : [];
    [ date, time ]     = pull_request.merged_at.split('T');

    if (amount === 0) {
      robot.logger.info('[hubot-kredits] Kredits amount from issue label is zero; ignoring');
      return Promise.resolve();
    } else if (repoBlackList.includes(repoName)) {
      robot.logger.debug(`[hubot-kredits] ${repoName} is on black list; ignoring`);
      return Promise.resolve();
    }

    let recipients;
    if (assignees.length > 0) {
      recipients = assignees;
    } else {
      recipients = [pull_request.user.login];
    }

    for (const recipient of recipients) {
      try {
        await createContribution(recipient, date, time, amount,
                                 kind, description, web_url,
                                 { pull_request, repository: data.repository });
        await sleep(60000);
      }
      catch (err) { robot.logger.error(err); }
    }

    return Promise.resolve();
  }

  robot.router.post('/incoming/kredits/gitea/'+process.env.KREDITS_WEBHOOK_TOKEN, (req, res) => {
    const evt = req.header('X-Gitea-Event');
    let data = req.body;
    // For some reason data is contained in a payload property on one
    // machine, but directly in the root of the object on others
    if (data.payload) { data = JSON.parse(data.payload); }

    robot.logger.info(`Received Gitea hook. Event: ${evt}, action: ${data.action}`);

    if (evt === 'pull_request' && data.action === 'closed' && data.pull_request.merged) {
      handleGiteaPullRequestClosed(data);
      res.sendStatus(200);
    }
    else if (evt === 'issues' && data.action === 'closed') {
      handleGiteaIssueClosed(data);
      res.sendStatus(200);
    } else {
      res.sendStatus(200);
    }
  });

};
