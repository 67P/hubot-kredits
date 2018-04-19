// Description:
//   Kosmos Kredits chat integration
//
// Configuration:
//   KREDITS_WEBHOOK_TOKEN: A string for building your secret webhook URL
//   KREDITS_ROOM: Kredit Proposals are posted to this chatroom
//   KREDITS_WALLET_PATH: Path to a etherum wallet JSON file
//   KREDITS_WALLET_PASSWORD: Wallet password
//   KREDITS_PROVIDER_URL: Ethereum JSON-RPC URL (default 'http://localhost:7545')
//   KREDITS_NETWORK_ID: The ethereum network ID to use (default 100 = local)
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

  function messageRoom(message) {
    robot.messageRoom(process.env.KREDITS_ROOM, message);
  }

  //
  // Ethereum wallet setup
  //

  let wallet;
  try {
    wallet = await ethers.Wallet.fromEncryptedWallet(walletJson, process.env.KREDITS_WALLET_PASSWORD);
  } catch(error) {
    robot.logger.warn('[hubot-kredits] Could not load wallet:', error);
    process.exit(1);
  }

  //
  // Ethereum provider/node setup
  //

  const ethProvider = new ethers.providers.JsonRpcProvider(providerUrl, {chainId: networkId});
  ethProvider.signer = wallet;
  wallet.provider = ethProvider;

  //
  // Kredits contracts setup
  //

  let kredits;
  try {
    kredits = await Kredits.setup(ethProvider, wallet, ipfsConfig);
  } catch(error) {
    robot.logger.warn('[hubot-kredits] Could not set up kredits:', error);
    process.exit(1);
  }
  const Contributor = kredits.Contributor;
  const Operator = kredits.Operator;

  robot.logger.info('[hubot-kredits] Wallet address: ' + wallet.address);

  //
  // Check robot's wallet balance and alert when it's broke
  //

  ethProvider.getBalance(wallet.address).then(balance => {
    robot.logger.info('[hubot-kredits] Wallet balance: ' + ethers.utils.formatEther(balance) + 'ETH');
    if (balance.lt(ethers.utils.parseEther('0.0001'))) {
      messageRoom(`Yo gang, I\'m broke! Please drop me some ETH to ${wallet.address}. kthxbai.`);
    }
  });

  //
  // Robot chat commands/interaction
  //

  robot.respond(/got ETH\??/i, res => {
    ethProvider.getBalance(wallet.address).then((balance) => {
      res.send(`my wallet contains ${ethers.utils.formatEther(balance)} ETH`);
    });
  });

  robot.respond(/propose (\d*)\s?\S*\s?to (\S+)(?:\sfor (.*))?$/i, res => {
    let [_, amount, githubUser, description] = res.match;
    let url = null;
    createProposal(githubUser, amount, description, url).then((result) => {
      messageRoom('Sounds good! Will be listed on https://kredits.kosmos.org in a bit...');
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
      messageRoom('https://kredits.kosmos.org');
    });
  });

  //
  // Smart contract events
  //

  function watchContractEvents() {
    ethProvider.getBlockNumber().then((blockNumber) => {
      // current block is the last mined one, thus we check from the next
      // mined one onwards to prevent getting previous events
      let nextBlock = blockNumber + 1;
      robot.logger.debug(`[hubot-kredits] Watching events from block ${nextBlock} onward`);
      ethProvider.resetEventsBlock(nextBlock);

      Operator.on('ProposalCreated', handleProposalCreated);
    });
  }

  function handleProposalCreated(proposalId, creatorAccount, contributorId, amount) {
    Contributor.getById(contributorId).then((contributor) => {
      Operator.getById(proposalId).then((proposal) => {
        robot.logger.debug(`[hubot-kredits] Proposal created (${proposal.description})`);
        // messageRoom(`Let's give ${contributor.name} some kredits for ${proposal.url} (${proposal.description}): https://kredits.kosmos.org`);
      });
    });
  }

  watchContractEvents();

  //
  // Integrations
  //

  require('./integrations/github')(robot, kredits);

  if (typeof process.env.KREDITS_MEDIAWIKI_URL !== 'undefined') {
    require('./integrations/mediawiki')(robot, kredits);
  }

};
