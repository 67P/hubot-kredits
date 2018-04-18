// Description:
//   Kosmos Kredits chat integration
//
// Configuration:
//   KREDITS_WEBHOOK_TOKEN: A string for building your secret webhook URL
//   KREDITS_ROOM: Kredit proposals are posted to this chatroom
//   KREDITS_WALLET_PATH: Path to a etherum wallet JSON file
//   KREDITS_WALLET_PASSWORD: Wallet password
//   KREDITS_PROVIDER_URL: Ethereum JSON-RPC URL (default 'http://localhost:7545')
//   IPFS_API_HOST: Host/domain (default 'localhost')
//   IPFS_API_PORT: Port number (default '5001')
//   IPFS_API_PROTOCOL: Protocol, e.g. 'http' or 'https' (default 'http')
//

const fs = require('fs');
const util = require('util');
const fetch = require('node-fetch');
const ethers = require('ethers');
const Kredits = require('kredits-contracts');

const walletPath  = process.env.KREDITS_WALLET_PATH || './wallet.json';
const walletJson  = fs.readFileSync(walletPath);
const providerUrl = process.env.KREDITS_PROVIDER_URL || 'http://localhost:7545';
const networkId = parseInt(process.env.KREDITS_NETWORK_ID || 100);

const ipfsConfig = {
  host: process.env.IPFS_API_HOST || 'localhost',
  port: process.env.IPFS_API_PORT || '5001',
  protocol: process.env.IPFS_API_PROTOCOL || 'http'
};

module.exports = async function(robot) {
  let wallet;
  try {
    wallet = await ethers.Wallet.fromEncryptedWallet(walletJson, process.env.KREDITS_WALLET_PASSWORD);
  } catch(error) {
    console.log('could not load wallet', error);
    process.exit(1);
  }

  const ethProvider = new ethers.providers.JsonRpcProvider(providerUrl, {chainId: networkId});
  ethProvider.signer = wallet;
  wallet.provider = ethProvider;

  let kredits;
  try {
    kredits = await Kredits.setup(ethProvider, wallet, ipfsConfig);
  } catch(error) {
    console.log('could not setup kredits', error);
    process.exit(1);
  }
  const Contributor = kredits.Contributor;
  const Operator = kredits.Operator;

  function messageRoom(message) {
    robot.messageRoom(process.env.KREDITS_ROOM, message);
  }

  robot.logger.info('[hubot-kredits] Wallet address: ' + wallet.address);

  ethProvider.getBalance(wallet.address).then(balance => {
    robot.logger.info('[hubot-kredits] Wallet balance: ' + ethers.utils.formatEther(balance) + 'ETH');
    if (balance.lt(ethers.utils.parseEther('0.0001'))) {
      messageRoom(`Yo gang, I\'m broke! Please drop me some ETH to ${wallet.address}. kthxbai.`);
    }
  });

  robot.respond(/got ETH\??/i, res => {
    ethProvider.getBalance(wallet.address).then((balance) => {
      res.send(`my wallet contains ${ethers.utils.formatEther(balance)} ETH`);
    });
  });

  robot.respond(/propose (\d*)\s?\S*\s?to (\S+)(?:\sfor (.*))?$/i, res => {
    let amount = res.match[1];
    let githubUser = res.match[2];
    let description = res.match[3];
    let url = null;
    createProposal(githubUser, amount, description, url).then((result) => {
      messageRoom('Sounds good! will be listed on http://kredits.kosmos.org in a bit');
    });
  });

  robot.respond(/list open proposals/i, res => {
    Operator.all().then((proposals) => {
      proposals.forEach((proposal) => {
        if (!proposal.executed) {
          Contributor.getById(proposal.contributorId).then((contributor) => {
            messageRoom(`* ${proposal.amount} kredits to ${contributor.name} for ${proposal.description}`);
          });
        }
      });
      messageRoom('http://kredits.kosmos.org');
    });
  });

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
    return getContributorByGithubUser(githubUser).then((contributor) => {
      robot.logger.debug(`[kredits] Creating proposal to issue ${amount}₭S to ${githubUser} for ${url}...`);
      let contributionAttr = {
        contributorId: contributor.id,
        amount: amount,
        contributorIpfsHash: contributor.ipfsHash,
        url,
        description,
        details,
        kind: 'dev'
      };
      return Operator.addProposal(contributionAttr).then((result) => {
          robot.logger.debug('[kredits] proposal created:', util.inspect(result));
        });
      }).catch((error) => {
        console.log(error);
        messageRoom(`I wanted to propose giving kredits to ${githubUser} for ${url}, but I can't find their contact data. Please add them as a contributor: https://kredits.kosmos.org`);
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
    return new Promise((resolve/*, reject*/) => {
      // fs.writeFileSync('tmp/github-issue.json', JSON.stringify(data, null, 4));
      let recipients;
      let issue        = data.issue;
      let assignees    = issue.assignees.map(a => a.login);
      let web_url      = issue.html_url;

      let amount = amountFromIssueLabels(issue);
      if (amount === 0) { resolve(); return; }

      if (assignees.length > 0) {
        recipients = assignees;
      } else {
        recipients = [issue.user.login];
      }

      let repoName = issue.repository_url.match(/.*\/(.+\/.+)$/)[1];
      let description = `${repoName}: ${issue.title}`;

      recipients.forEach(recipient => {
        createProposal(recipient, amount, description, web_url, issue)
          .catch(err => robot.logger.error(err));
      });

      resolve();
    });
  }

  function handleGitHubPullRequestClosed(data) {
    return new Promise((resolve, reject) => {
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

      fetch(pr_issue_url)
        .then(response => {
          if (response.status >= 400) {
            reject('Bad response from fetching PR issue');
          }
          return response.json();
        })
        .then(issue => {
          // fs.writeFileSync('tmp/github-pr-issue.json', JSON.stringify(data, null, 4));
          let amount = amountFromIssueLabels(issue);
          if (amount === 0) { resolve(); return; }

          let repoName = pull_request.base.repo.full_name;
          let description = `${repoName}: ${pull_request.title}`;

          let proposalPromisses = [];
          recipients.forEach(recipient => {
            proposalPromisses.push(
              createProposal(recipient, amount, description, web_url, pull_request)
                .catch(err => robot.logger.error(err))
            );
          });
          return Promise.all(proposalPromisses);
        });
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

  function watchContractEvents() {
    ethProvider.getBlockNumber().then((blockNumber) => {
      // current block is the last mined one, thus we check from the next
      // mined one onwards to prevent getting previous events
      let nextBlock = blockNumber + 1;
      robot.logger.debug(`[kredits] watching events from block ${nextBlock} onward`);
      ethProvider.resetEventsBlock(nextBlock);

      Operator.on('ProposalCreated', handleProposalCreated);
    });
  }

  function handleProposalCreated(proposalId, creatorAccount, contributorId, amount) {
    Contributor.getById(contributorId).then((contributor) => {
      Operator.getById(proposalId).then((proposal) => {
        messageRoom(`Let's give ${contributor.name} some kredits for ${proposal.url} (${proposal.description}): https://kredits.kosmos.org`);
      });
    });
  }

  watchContractEvents();

};
