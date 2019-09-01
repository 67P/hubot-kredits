const util = require('util');
const fetch = require('node-fetch');
const session = require('express-session');
const grant = require('grant-express');
const cors = require('cors');
const amountFromLabels = require('./utils/amount-from-labels');
const kindFromLabels = require('./utils/kind-from-labels');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

  const kreditsWebUrl = process.env.KREDITS_WEB_URL || 'https://kredits.kosmos.org';

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

  function createContribution(githubUser, date, time, amount, kind, description, url, details) {
    return getContributorByGithubUser(githubUser).then(contributor => {
      robot.logger.info(`[hubot-kredits] Creating contribution token for ${amount}₭S to ${githubUser} for ${url}...`);

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

      return Contribution.addContribution(contributionAttr).catch(error => {
        robot.logger.error(`[hubot-kredits] Error:`, error);
        messageRoom(`I tried to add a contribution for ${githubUser} for ${url}, but I encountered an error when submitting the tx:`);
        messageRoom(error.message);
      });
    });
  }

  async function handleGitHubIssueClosed(data) {
    let recipients;
    const issue       = data.issue;
    const assignees   = issue.assignees.map(a => a.login);
    const web_url     = issue.html_url;

    [date, time]      = issue.closed_at.split('T');
    const labels      = issue.labels.map(l => l.name);
    const amount      = amountFromLabels(labels);
    const kind        = kindFromLabels(labels);
    const repoName    = issue.repository_url.match(/.*\/(.+\/.+)$/)[1];
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
        await createContribution(recipient, date, time, amount, kind, description, web_url, issue);
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
        const labels      = issue.labels.map(l => l.name);
        const amount      = amountFromLabels(labels);
        const kind        = kindFromLabels(labels);
        const repoName    = pull_request.base.repo.full_name;
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
            await createContribution(recipient, date, time, amount, kind, description, web_url, pull_request);
            await sleep(60000);
          }
          catch (err) { robot.logger.error(err); }
        }

        return Promise.resolve();
      });
  }

  robot.router.post('/incoming/kredits/github/'+process.env.KREDITS_WEBHOOK_TOKEN, (req, res) => {
    const evt = req.header('X-GitHub-Event');
    let data = req.body;
    // For some reason data is contained in a payload property on one
    // machine, but directly in the root of the object on others
    if (data.payload) { data = JSON.parse(data.payload); }

    robot.logger.info(`Received GitHub hook. Event: ${evt}, action: ${data.action}`);

    if (evt === 'pull_request' && data.action === 'closed' && data.pull_request.merged) {
      handleGitHubPullRequestClosed(data);
      res.sendStatus(200);
    }
    else if (evt === 'issues' && data.action === 'closed') {
      handleGitHubIssueClosed(data);
      res.sendStatus(200);
    } else {
      res.sendStatus(200);
    }
  });

  //
  // GitHub signup
  //

  if (process.env.KREDITS_GITHUB_KEY && process.env.KREDITS_GITHUB_SECRET) {
    const grantConfig = {
      defaults: {
        protocol: (process.env.KREDITS_GRANT_PROTOCOL || "http"),
        host: (process.env.KREDITS_GRANT_HOST || 'localhost:8888'),
        transport: 'session',
        response: 'tokens',
        path: '/kredits/signup'
      },
      github: {
        key: process.env.KREDITS_GITHUB_KEY,
        secret: process.env.KREDITS_GITHUB_SECRET,
        callback: '/kredits/signup/github'
      }
    };

    robot.router.use(session({
      secret: process.env.KREDITS_SESSION_SECRET || 'grant',
      resave: false,
      saveUninitialized: false
    }));

    robot.router.use('/kredits/signup', grant(grantConfig));

    robot.router.get('/kredits/signup/github', async (req, res) => {
      const access_token = req.session.grant.response.access_token;

      res.redirect(`${kreditsWebUrl}/signup/github#access_token=${access_token}`);
    });

    robot.router.options('/kredits/signup/github', cors());

    robot.router.post('/kredits/signup/github', cors(), async (req, res) => {
      const accessToken = req.body.accessToken;
      if (!accessToken) {
        res.status(400).json({});
        return;
      }
      let githubResponse;
      try {
        githubResponse = await fetch('https://api.github.com/user', {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `token ${accessToken}`
          }
        });
      } catch (error) {
        robot.logger.error('[hubot-kredits] Fetching user data from GitHub failed:', error);
        res.status(500).json({ error });
      };

      if (githubResponse.status >= 300) {
        res.status(githubResponse.status).json({});
        return;
      }
      const user = await githubResponse.json();

      const contributor = await kredits.Contributor.findByAccount({
        site: 'github.com',
        username: user.login
      });

      if (!contributor) {
        let contributorAttr = {};
        contributorAttr.account = req.body.account;
        contributorAttr.name = user.name || user.login;
        contributorAttr.kind = "person";
        contributorAttr.url = user.blog;
        contributorAttr.github_username = user.login;
        contributorAttr.github_uid = user.id;

        kredits.Contributor.add(contributorAttr, { gasLimit: 350000 })
          .then(transaction => {
            robot.logger.info('[hubot-kredits] Contributor added from GitHub signup', transaction.hash);
            res.status(201);
            res.json({
              transactionHash: transaction.hash,
              github_username: user.login
            });
          }, error => {
            robot.logger.error(`[hubot-kredits] Adding contributor failed: ${error}`);
            res.status(422);
            res.json({ error })
          });
      } else {
        res.json({
          github_username: user.login
        });
      }
    });
  } else {
    robot.logger.warning('[hubot-kredits] No KREDITS_GITHUB_KEY and KREDITS_GITHUB_SECRET configured for OAuth signup');
  }
};
