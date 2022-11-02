const fs = require('fs');
const ethers = require('ethers');
const NonceManager = require('@ethersproject/experimental').NonceManager;
const Kredits = require('@kredits/contracts');

const walletPath  = process.env.KREDITS_WALLET_PATH || './wallet.json';
const walletJson  = fs.readFileSync(walletPath);
const providerUrl = process.env.KREDITS_PROVIDER_URL || 'http://localhost:7545';

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
    wallet = await ethers.Wallet.fromEncryptedJson(walletJson, process.env.KREDITS_WALLET_PASSWORD);
  } catch(error) {
    robot.logger.warning('[hubot-kredits] Could not load wallet:', error);
    process.exit(1);
  }

  //
  // Ethereum provider/node setup
  //

  robot.logger.info('[hubot-kredits] Using blockchain node/API at', providerUrl);

  const ethProvider = new ethers.providers.JsonRpcProvider(providerUrl);
  const signer = new NonceManager(wallet.connect(ethProvider));

  //
  // Kredits contracts setup
  //

  const opts = { ipfsConfig };
  let kredits;

  try {
    kredits = await new Kredits(signer.provider, signer, opts).init();
  } catch(error) {
    robot.logger.warning('[hubot-kredits] Could not set up kredits:', error);
    process.exit(1);
  }
  const Contributor = kredits.Contributor;
  const Contribution = kredits.Contribution;
  // TODO const Reimbursement = kredits.Reimbursement;

  robot.logger.info('[hubot-kredits] Wallet address: ' + wallet.address);

  //
  // Check robot's wallet balance and alert when it's broke
  //

  ethProvider.getBalance(wallet.address).then(balance => {
    robot.logger.info('[hubot-kredits] Wallet balance: ' + ethers.utils.formatEther(balance) + ' RBTC');
    if (balance.lt(ethers.utils.parseEther('0.0001'))) {
      messageRoom(`Yo gang, I\'m broke! Please send some RBTC to ${wallet.address}. kthxbai.`);
    }
  });

  //
  // Robot chat commands/interaction
  //

  robot.respond(/got RBTC\??/i, res => {
    ethProvider.getBalance(wallet.address).then((balance) => {
      res.send(`My wallet contains ${ethers.utils.formatEther(balance)} RBTC`);
    });
  });

  //
  // Smart contract events
  //

  function watchContractEvents() {
    ethProvider.getBlockNumber().then(blockNumber => {
      // current block is the last mined one, thus we check from the next
      // mined one onwards to prevent getting previous events
      let nextBlock = blockNumber + 1;
      robot.logger.debug(`[hubot-kredits] Watching events from block ${nextBlock} onward`);
      ethProvider.resetEventsBlock(nextBlock);

      // TODO handle all known events (that make sense here)
      // Contribution.on('ContributorAdded', handleContributorAdded);
      Contribution.on('ContributionAdded', handleContributionAdded);
    });
  }

  function handleContributionAdded(contributionId, contributorId, amount) {
    Contributor.getById(contributorId).then(_ => {
      Contribution.getById(contributionId).then(contribution => {
        robot.logger.debug(`[hubot-kredits] Contribution #${contribution.id} added (${amount} kredits for "${contribution.description}")`);
      });
    });
  }

  watchContractEvents();

  //
  // Integrations
  //

  require('./integrations/github')(robot, kredits);
  require('./integrations/gitea')(robot, kredits);

  if (typeof process.env.KREDITS_ZOOM_JWT !== 'undefined') {
    require('./integrations/zoom')(robot, kredits);
  }

  if (typeof process.env.KREDITS_MEDIAWIKI_URL !== 'undefined') {
    require('./integrations/mediawiki')(robot, kredits);
  }

};
