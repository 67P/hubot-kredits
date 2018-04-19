const util = require('util');
const fetch = require('node-fetch');

module.exports = async function(robot, kredits) {

  robot.logger.debug('[hubot-kredits] Loading GitHub integration...');


  const Contributor = kredits.Contributor;
  const Operator = kredits.Operator;

  function getContributorByGithubUser(username) {
    return Contributor.all().then(contributors => {
      let contrib = contributors.find(c => {
        return c.github_username === username;
      });
      if (!contrib) {
        throw new Error(`No contributor found for ${username}`);A
      } else {
        return contrib;
      }
    });
  }

  function createProposal(githubUser, amount, description, url, details) {
    return getContributorByGithubUser(githubUser).then(contributor => {
      robot.logger.debug(`[hubot-kredits] Creating proposal to issue ${amount}₭S to ${githubUser} for ${url}...`);

      let contributionAttr = {
        contributorId: contributor.id,
        amount: amount,
        contributorIpfsHash: contributor.ipfsHash,
        url,
        description,
        details,
        kind: 'dev'
      };

      return Operator.addProposal(contributionAttr).catch(error => {
        robot.logger.info(`[hubot-kredits] Error:`, error);
        messageRoom(`I wanted to propose giving kredits to ${githubUser} for ${url}, but I cannot find their contact data. Please add them as a contributor: https://kredits.kosmos.org`);
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
        amount = 50;
        break;
      case 'kredits-2':
        amount = 150;
        break;
      case 'kredits-3':
        amount = 500;
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
    if (amount === 0) {
      robot.logger.info('[hubot-kredits] Proposal amount from issue label is zero; ignoring');
      return Promise.resolve();
    }

    if (assignees.length > 0) {
      recipients = assignees;
    } else {
      recipients = [issue.user.login];
    }

    let repoName = issue.repository_url.match(/.*\/(.+\/.+)$/)[1];
    let description = `${repoName}: ${issue.title}`;

    let proposalPromisses = [];
    recipients.forEach(recipient => {
      proposalPromisses.push(
        createProposal(recipient, amount, description, web_url, issue)
          .catch(err => robot.logger.error(err))
      );
    });

    return Promise.all(proposalPromisses);
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
        if (amount === 0) {
          robot.logger.info('[hubot-kredits] Proposal amount from issue label is zero; ignoring');
          return;
        }

        let repoName = pull_request.base.repo.full_name;
        let description = `${repoName}: ${pull_request.title}`;

        let proposalPromisses = [];
        recipients.forEach(recipient => {
          console.debug(`[hubot-kredits] Creating proposal for ${recipient}...`);
          proposalPromisses.push(
            createProposal(recipient, amount, description, web_url, pull_request)
              .catch(err => robot.logger.error(err))
          );
        });
        return Promise.all(proposalPromisses);
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
