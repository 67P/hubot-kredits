const util = require('util');
const fetch = require('node-fetch');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function(robot, kredits) {

  function messageRoom(message) {
    robot.messageRoom(process.env.KREDITS_ROOM, message);
  }

  robot.logger.debug('[hubot-kredits] Loading GitHub integration...');

  const repoBlackList = [];
  if (process.env.KREDITS_GITHUB_REPO_BLACKLIST) {
    repoBlackList = process.env.KREDITS_GITHUB_REPO_BLACKLIST.split(',');
    robot.logger.debug('[hubot-kredits] Ignoring GitHub actions from ', util.inspect(repoBlackList));
  }

  const Contributor = kredits.Contributor;
  const Contribution = kredits.Contribution;

  function getContributorByGithubUser(username) {
    return Contributor.all().then(contributors => {
      const contrib = contributors.find(c => {
        return c.github_username === username;
      });
      if (!contrib) {
        throw new Error(`No contributor found for ${username}`);
      } else {
        return contrib;
      }
    });
  }

  function createContribution(githubUser, date, time, amount, description, url, details) {
    return getContributorByGithubUser(githubUser).then(contributor => {
      robot.logger.debug(`[hubot-kredits] Creating contribution token for ${amount}₭S to ${githubUser} for ${url}...`);

      const contributionAttr = {
        contributorId: contributor.id,
        contributorIpfsHash: contributor.ipfsHash,
        date,
        time,
        amount,
        url,
        description,
        details,
        kind: 'dev'
      };

      return Contribution.addContribution(contributionAttr).catch(error => {
        robot.logger.error(`[hubot-kredits] Error:`, error);
        messageRoom(`I tried to add a contribution for ${githubUser} for ${url}, but I encountered an error when submitting the tx:`);
        messageRoom(error.message);
      });
    });
  }

  function amountFromIssueLabels(issue) {
    const kreditsLabel = issue.labels.map(l => l.name)
                              .filter(n => n.match(/^kredits/))[0];
    // No label, no kredits
    if (typeof kreditsLabel === 'undefined') { return 0; }

    // TODO move to config maybe?
    let amount;
    switch(kreditsLabel) {
      case 'kredits-1':
        amount = 500;
        break;
      case 'kredits-2':
        amount = 1500;
        break;
      case 'kredits-3':
        amount = 5000;
        break;
    }

    return amount;
  }

  async function handleGitHubIssueClosed(data) {
    let recipients;
    const issue        = data.issue;
    const assignees    = issue.assignees.map(a => a.login);
    const web_url      = issue.html_url;

    [date, time] = issue.closed_at.split('T');
    const amount = amountFromIssueLabels(issue);
    const repoName = issue.repository_url.match(/.*\/(.+\/.+)$/)[1];
    const description = `${repoName}: ${issue.title}`;

    if (amount === 0) {
      robot.logger.info('[hubot-kredits] Kredits amount from issue label is zero; ignoring');
      return Promise.resolve();
    } else if (repoBlackList.includes(repoName)) {
      robot.logger.debug(`[hubot-kredits] ${repoName} is on black list; ignoring`);
      return Promise.resolve();
    }

    if (assignees.length > 0) {
      recipients = assignees;
    } else {
      recipients = [issue.user.login];
    }

    for (const recipient of recipients) {
      try {
        await createContribution(recipient, date, time, amount, description, web_url, issue);
        await sleep(60000);
      }
      catch (err) { robot.logger.error(err); }
    }

    return Promise.resolve();
  }

  function handleGitHubPullRequestClosed(data) {
    let recipients;
    const pull_request = data.pull_request;
    const assignees    = pull_request.assignees.map(a => a.login);
    const web_url      = pull_request._links.html.href;
    const pr_issue_url = pull_request.issue_url;

    [date, time] = pull_request.merged_at.split('T');

    if (assignees.length > 0) {
      recipients = assignees;
    } else {
      recipients = [pull_request.user.login];
    }

    return fetch(pr_issue_url)
      .then(response => {
        if (response.status >= 400) {
          throw new Error('Bad response from fetching PR issue');
        }
        return response.json();
      })
      .then(async (issue) => {
        const amount = amountFromIssueLabels(issue);
        const repoName = pull_request.base.repo.full_name;
        const description = `${repoName}: ${pull_request.title}`;

        if (amount === 0) {
          robot.logger.info('[hubot-kredits] Kredits amount from issue label is zero; ignoring');
          return Promise.resolve();
        } else if (repoBlackList.includes(repoName)) {
          robot.logger.debug(`[hubot-kredits] ${repoName} is on black list; ignoring`);
          return Promise.resolve();
        }

        for (const recipient of recipients) {
          try {
            await createContribution(recipient, date, time, amount, description, web_url, pull_request);
            await sleep(60000);
          }
          catch (err) { robot.logger.error(err); }
        }

        return Promise.resolve();
      });
  }

  robot.router.post('/incoming/kredits/github/'+process.env.KREDITS_WEBHOOK_TOKEN, (req, res) => {
    const evt = req.header('X-GitHub-Event');
    const data = req.body;
    // For some reason data is contained in a payload property on one
    // machine, but directly in the root of the object on others
    if (data.payload) { data = JSON.parse(data.payload); }

    robot.logger.info(`Received GitHub hook. Event: ${evt}, action: ${data.action}`);

    if (evt === 'pull_request' && data.action === 'closed' && data.pull_request.merged) {
      handleGitHubPullRequestClosed(data);
      res.send(200);
    }
    else if (evt === 'issues' && data.action === 'closed') {
      handleGitHubIssueClosed(data);
      res.send(200);
    } else {
      res.send(200);
    }
  });

};
