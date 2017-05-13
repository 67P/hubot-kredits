// Description:
//   Kosmos Kredits chat integration
//
// Configuration:
//   KREDITS_WEBHOOK_TOKEN: A string for building your secret webhook URL
//   KREDITS_ROOM: Kredit proposals are posted to this chatroom
//   KREDITS_WALLET_PATH: Path to a etherum wallet JSON file
//   KREDITS_WALLET_PASSWORD: Wallet password
//
const fs = require('fs');
const fetch = require('node-fetch');
const kreditsContracts = require('kredits-contracts');
const ProviderEngine = require('web3-provider-engine');
const Wallet = require('ethereumjs-wallet');
const WalletSubprovider = require('ethereumjs-wallet/provider-engine');
const Web3Subprovider = require('web3-provider-engine/subproviders/web3.js');
const Web3 = require('web3');

(function() {
  "use strict";

  let engine = new ProviderEngine();

  let walletPath = process.env.KREDITS_WALLET_PATH || './wallet.json';
  let walletJson = fs.readFileSync(walletPath);
  let wallet = Wallet.fromV3(JSON.parse(walletJson), process.env.KREDITS_WALLET_PASSWORD);
  let providerUrl = process.env.KREDITS_PROVIDER_URL || 'http://localhost:8545';
  let hubotWalletAddress = '0x' + wallet.getAddress().toString('hex');

  let config = {};
  if (process.env.KREDITS_CONTRACT_ADDRESS) {
    config = { Kredits: { address: process.env.KREDITS_CONTRACT_ADDRESS }};
  }

  engine.addProvider(new WalletSubprovider(wallet, {}));
  engine.addProvider(new Web3Subprovider(new Web3.providers.HttpProvider(providerUrl)));
  // TODO only start engine if providerURL is accessible
  engine.start();

  let web3 = new Web3(engine);
  web3.eth.defaultAccount = hubotWalletAddress;

  let contracts = kreditsContracts(web3, config);
  let kredits = contracts['Kredits'];

  module.exports = function(robot) {

    robot.logger.info('[hubot-kredits] Wallet address: ' + hubotWalletAddress);

    getBalance().then(balance => {
      if (balance <= 0) {
        messageRoom(`Yo gang, I\'m broke! Please drop me some ETH to ${hubotWalletAddress}. kthxbai.`);
      }
    });

    function getBalance() {
      return new Promise((resolve, reject) => {
        web3.eth.getBalance(hubotWalletAddress, function (err, balance) {
          if (err) {
            robot.logger.error('[hubot-kredits] Error checking balance');
            reject(err);
            return;
          }
          resolve(balance);
        });
      });
    }

    function getValueFromContract(contractMethod, ...args) {
      return new Promise((resolve, reject) => {
        kredits[contractMethod](...args, (err, data) => {
          if (err) { reject(err); }
          resolve(data);
        });
      });
    }

    function getContributorData(i) {
      let promise = new Promise((resolve, reject) => {
        getValueFromContract('contributorAddresses', i).then(address => {
          robot.logger.debug('address', address);
          getValueFromContract('contributors', address).then(person => {
            robot.logger.debug('person', person);
            let contributor = {
              address: address,
              github_username: person[1],
              github_uid: person[0],
              ipfsHash: person[2]
            };
            robot.logger.debug('[kredits] contributor', contributor);
            resolve(contributor);
          });
        }).catch(err => reject(err));
      });
      return promise;
    }

    function getContributors() {
      return getValueFromContract('contributorsCount').then(contributorsCount => {
        let contributors = [];

        for(var i = 0; i < contributorsCount.toNumber(); i++) {
          contributors.push(getContributorData(i));
        }

        return Promise.all(contributors);
      });
    }

    function getContributorByGithubUser(username) {
      let promise = new Promise((resolve, reject) => {
        getContributors().then(contributors => {
          let contrib = contributors.find(c => {
            return c.github_username === username;
          });
          if (contrib) {
            resolve(contrib);
          } else {
            reject();
          }
        });
      });
      return promise;
    }

    function messageRoom(message) {
      robot.messageRoom(process.env.KREDITS_ROOM, message);
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

    function createProposal(recipient, amount, url/*, metaData*/) {
      return new Promise((resolve, reject) => {
        // TODO write metaData to IPFS
        robot.logger.debug(`Creating proposal to issue ${amount}₭S to ${recipient} for ${url}...`);

        getContributorByGithubUser(recipient).then(c => {
          kredits.addProposal(c.address, amount, url, '', (e/* , d */) => {
            if (e) { reject(); return; }
            messageRoom(`New proposal created: ${amount} for ${recipient}`);
          });
        }, () => {
          messageRoom(`Couldn\'t find contributor data for ${recipient}. Please add them first!`);
        });

        resolve();
      });
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

        recipients.forEach(recipient => {
          createProposal(recipient, amount, web_url, issue);
        });

        resolve();
      });
    }

    function handleGitHubPullRequestClosed(data) {
      return new Promise((resolve, reject) => {
        // fs.writeFileSync('tmp/github-pr.json', JSON.stringify(data, null, 4));
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

            recipients.forEach(recipient => {
              createProposal(recipient, amount, web_url, pull_request);
            });

            resolve();
          });
      });
    }

    robot.respond(/(got ETH)|(got gas)\?/i, res => {
      getBalance().then(balance => {
        if (balance <= 0) {
          res.send(`HALP, I\'m totally broke! Not a single wei in my pocket.`);
        }
        else if (balance >= 1e+17) {
          res.send(`my wallet contains ${web3.fromWei(balance, 'ether')} ETH`);
        }
        else {
          res.send(`I\'m almost broke! Only have ${web3.fromWei(balance, 'ether')} ETH left in my pocket. :(`);
        }
      });
    });

    robot.router.post('/incoming/kredits/github/'+process.env.KREDITS_WEBHOOK_TOKEN, (req, res) => {
      let evt = req.header('X-GitHub-Event');
      let data = req.body;
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
}());
