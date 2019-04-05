const util = require('util');
const fetch = require('node-fetch');

module.exports = async function(robot, kredits) {

  function messageRoom(message) {
    robot.messageRoom(process.env.KREDITS_ROOM, message);
  }

  robot.logger.debug('[hubot-kredits] Loading GitHub integration...');

  let repoBlackList = [];
  if (process.env.KREDITS_GITHUB_REPO_BLACKLIST) {
    repoBlackList = process.env.KREDITS_GITHUB_REPO_BLACKLIST.split(',');
    robot.logger.debug('[hubot-kredits] Ignoring GitHub actions from ', util.inspect(repoBlackList));
  }

  const Contributor = kredits.Contributor;
  const Contribution = kredits.Contribution;

  function getContributorByGithubUser(username) {
    return Contributor.all().then(contributors => {
      let contrib = contributors.find(c => {
        return c.github_username === username;
      });
      if (!contrib) {
        throw new Error(`No contributor found for ${username}`);
      } else {
        return contrib;
      }
    });
  }

  function createContribution(githubUser, amount, description, url, details) {
    return getContributorByGithubUser(githubUser).then(contributor => {
      robot.logger.debug(`[hubot-kredits] Creating contribution token for ${amount}₭S to ${githubUser} for ${url}...`);

      let contributionAttr = {
        contributorId: contributor.id,
        amount: amount,
        contributorIpfsHash: contributor.ipfsHash,
        url,
        description,
        details,
        kind: 'dev'
      };

      return Contribution.addContribution(contributionAttr).catch(error => {
        robot.logger.error(`[hubot-kredits] Error:`, error);
        messageRoom(`I wanted to propose giving kredits to GitHub user ${githubUser} for ${url}, but I cannot find their info. Please add them as a contributor: https://kredits.kosmos.org`);
      });
    });
  }

  function amountFromIssueLabels(issue) {
    let kreditsLabel = issue.labels.map(l => l.name)
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

  function handleGitHubIssueClosed(data) {
    let recipients;
    let issue        = data.issue;
    let assignees    = issue.assignees.map(a => a.login);
    let web_url      = issue.html_url;

    let amount = amountFromIssueLabels(issue);
    let repoName = issue.repository_url.match(/.*\/(.+\/.+)$/)[1];
    let description = `${repoName}: ${issue.title}`;

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

    let contributionPromises = [];
    recipients.forEach(recipient => {
      contributionPromises.push(
        createContribution(recipient, amount, description, web_url, issue)
          .catch(err => robot.logger.error(err))
      );
    });

    return Promise.all(contributionPromises);
  }

  function handleGitHubPullRequestClosed(data) {
    let recipients;
    let pull_request = data.pull_request;
    let assignees    = pull_request.assignees.map(a => a.login);
    let web_url      = pull_request._links.html.href;
    let pr_issue_url = pull_request.issue_url;

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
      .then(issue => {
        let amount = amountFromIssueLabels(issue);
        let repoName = pull_request.base.repo.full_name;
        let description = `${repoName}: ${pull_request.title}`;

        if (amount === 0) {
          robot.logger.info('[hubot-kredits] Kredits amount from issue label is zero; ignoring');
          return Promise.resolve();
        } else if (repoBlackList.includes(repoName)) {
          robot.logger.debug(`[hubot-kredits] ${repoName} is on black list; ignoring`);
          return Promise.resolve();
        }

        let contributionPromises = [];
        recipients.forEach(recipient => {
          robot.logger.debug(`[hubot-kredits] Creating contribution token for ${recipient}...`);
          contributionPromises.push(
            createContribution(recipient, amount, description, web_url, pull_request)
              .catch(err => robot.logger.error(err))
          );
        });

        return Promise.all(contributionPromises);
      });
  }

  robot.router.post('/incoming/kredits/github/'+process.env.KREDITS_WEBHOOK_TOKEN, (req, res) => {
    let evt = req.header('X-GitHub-Event');
    let data = req.body;
    // For some reason data is contained in a payload property on one
    // machine, but directly in the root of the object on others
    if (data.payload) { data = JSON.parse(data.payload); }

    robot.logger.info(`Received GitHub hook. Event: ${evt}, action: ${data.action}`);

    if (evt === 'pull_request' && data.action === 'closed') {
      handleGitHubPullRequestClosed(data).then(() => res.send(200));
    }
    else if (evt === 'issues' && data.action === 'closed') {
      handleGitHubIssueClosed(data).then(() => res.send(200));
    } else {
      res.send(200);
    }
  });

};
