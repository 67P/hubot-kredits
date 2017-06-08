// Description:
//   Kosmos Kredits chat integration
//
// Configuration:
//   KREDITS_WEBHOOK_TOKEN: A string for building your secret webhook URL
//   KREDITS_ROOM: Kredit proposals are posted to this chatroom
//   KREDITS_WALLET_PATH: Path to a etherum wallet JSON file
//   KREDITS_WALLET_PASSWORD: Wallet password
//   KREDITS_CONTRACT_ADDRESS: Address of Kredits contract
//   KREDITS_PROVIDER_URL: Ethereum JSON-RPC URL (default 'http://localhost:8545')
//   IPFS_API_HOST: Host/domain (default 'localhost')
//   IPFS_API_PORT: Port number (default '5001')
//   IPFS_API_PROTOCOL: Protocol, e.g. 'http' or 'https' (default 'http')
//
const fs = require('fs');
const util = require('util');
const fetch = require('node-fetch');
const kreditsContracts = require('kredits-contracts');
const ProviderEngine = require('web3-provider-engine');
const Wallet = require('ethereumjs-wallet');
const WalletSubprovider = require('ethereumjs-wallet/provider-engine');
const Web3Subprovider = require('web3-provider-engine/subproviders/web3.js');
const Web3 = require('web3');
const ipfsAPI = require('ipfs-api');
const schemas = require('kosmos-schemas');
const tv4 = require('tv4');

(function() {
  "use strict";

  //
  // Instantiate ethereum client and wallet
  //
  let engine = new ProviderEngine();

  let walletPath  = process.env.KREDITS_WALLET_PATH || './wallet.json';
  let walletJson  = fs.readFileSync(walletPath);
  let wallet      = Wallet.fromV3(JSON.parse(walletJson), process.env.KREDITS_WALLET_PASSWORD);
  let providerUrl = process.env.KREDITS_PROVIDER_URL || 'http://localhost:8545';
  let hubotWalletAddress = '0x' + wallet.getAddress().toString('hex');

  engine.addProvider(new WalletSubprovider(wallet, {}));
  engine.addProvider(new Web3Subprovider(new Web3.providers.HttpProvider(providerUrl)));
  // TODO only start engine if providerURL is accessible
  engine.start();

  let web3 = new Web3(engine);
  web3.eth.defaultAccount = hubotWalletAddress;

  //
  // Instantiate contracts
  //
  let contractConfig = {};
  if (process.env.KREDITS_CONTRACT_ADDRESS) {
    contractConfig = { Kredits: { address: process.env.KREDITS_CONTRACT_ADDRESS }};
  }
  let contracts = kreditsContracts(web3, contractConfig);
  let kredits = contracts['Kredits'];

  //
  // Instantiate IPFS API client
  //
  let ipfsConfig = {};
  if (process.env.IPFS_API_HOST) {
    ipfsConfig = {
      host: process.env.IPFS_API_HOST,
      port: process.env.IPFS_API_PORT,
      protocol: process.env.IPFS_API_PROTOCOL
    };
  }
  let ipfs = ipfsAPI(ipfsConfig);

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

    function loadProfileFromIPFS(contributor) {
      let promise = new Promise((resolve, reject) => {
        return ipfs.cat(contributor.ipfsHash, { buffer: true }).then(res => {
          let content = res.toString();
          let profile = JSON.parse(content);

          contributor.name = profile.name;
          contributor.kind = profile.kind;

          let accounts = profile.accounts;
          let github   = accounts.find(a => a.site === 'github.com');
          let wiki     = accounts.find(a => a.site === 'wiki.kosmos.org');

          if (github) {
            contributor.github_username = github.username;
            contributor.github_uid = github.uid;
          }
          if (wiki) {
            contributor.wiki_username = wiki.username;
          }

          resolve(contributor);
        }).catch((err) => {
          console.log(err);
          reject(err);
        });
      });

      return promise;
    }

    function getContributorData(i) {
      let promise = new Promise((resolve, reject) => {
        getValueFromContract('contributorAddresses', i).then(address => {
          robot.logger.debug('address', address);
          getValueFromContract('contributors', address).then(person => {
            robot.logger.debug('person', person);
            let c = {
              address: address,
              name: person[1],
              id: person[0],
              ipfsHash: person[2]
            };
            if (c.ipfsHash) {
              loadProfileFromIPFS(c).then(contributor => {
                robot.logger.debug('[kredits] contributor', contributor);
                resolve(contributor);
              }).catch(() => console.log('[kredits] error fetching contributor info from IPFS for '+c.name));
            } else {
              resolve(c);
            }
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

    function createContributionDocument(contributor, url, description, details) {
      let contribution = {
        "@context": "https://schema.kosmos.org",
        "@type": "Contribution",
        contributor: {
          ipfs: contributor.ipfsHash
        },
        kind: 'dev',
        url: url,
        description: description,
        details: details
      };

      if (! tv4.validate(contribution, schemas["contribution"])) {
        console.log('[kredits] invalid contribution data: ', util.inspect(contribution));
        return Promise.reject('invalid contribution data');
      }

      return ipfs.add(new ipfs.Buffer(JSON.stringify(contribution)))
        .then(res => { return res[0].hash; })
        .catch(err => console.log(err));
    }

    function createProposal(recipient, amount, url, description, details) {
      robot.logger.debug(`Creating proposal to issue ${amount}₭S to ${recipient} for ${url}...`);

      return new Promise((resolve, reject) => {
        // Get contributor details for GitHub user
        getContributorByGithubUser(recipient).then(c => {
          // Create document containing contribution data on IPFS
          createContributionDocument(c, url, description, details).then(ipfsHash => {
            // Create proposal on ethereum blockchain
            kredits.addProposal(c.address, amount, url, ipfsHash, (e/* , d */) => {
              if (e) { reject(e); return; }
              messageRoom(`Let's give ${recipient} some kredits for ${url}: https://kredits.kosmos.org`);
            });
          });
        }, () => {
          messageRoom(`I wanted to propose giving kredits to ${recipient} for ${url}, but I can't find their contact data. Please add them as a contributor: https://kredits.kosmos.org`);
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

        let repoName = issue.repository_url.match(/.*\/(.+\/.+)$/)[1];
        let description = `${repoName}: ${issue.title}`;

        recipients.forEach(recipient => {
          createProposal(recipient, amount, web_url, description, issue);
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

            let repoName = pull_request.base.repo.full_name;
            let description = `${repoName}: ${pull_request.title}`;

            recipients.forEach(recipient => {
              createProposal(recipient, amount, web_url, description, pull_request);
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
}());
