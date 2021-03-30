#!/usr/bin/env node

require('dotenv').config({ path: '.env' });
const GiteaReviews = require('./lib/gitea-reviews');
const GithubReviews = require('./lib/github-reviews');

const ethers = require('ethers');
const NonceManager = require('@ethersproject/experimental').NonceManager;
const Kredits = require('kredits-contracts');
const util = require('util');

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');

const walletPath  = process.env.KREDITS_WALLET_PATH || '../wallet.json';
const walletJson  = fs.readFileSync(walletPath);
const providerUrl = process.env.KREDITS_PROVIDER_URL;
const daoAddress  = process.env.KREDITS_DAO_ADDRESS;

const ipfsConfig = {
  host: process.env.IPFS_API_HOST || 'localhost',
  port: process.env.IPFS_API_PORT || '5001',
  protocol: process.env.IPFS_API_PROTOCOL || 'http'
};

const kreditsAmounts = {
  'kredits-1': 100,
  'kredits-2': 300,
  'kredits-3': 1000
};

const repos = require('../repos.json');

const argv = yargs(hideBin(process.argv))
  .option('start', {
    alias: 's',
    description: 'Include reviews for PRs merged after this date'
  })
  .option('end', {
    alias: 'e',
    description: 'Include reviews for PRs merged before this date'
  })
  .option('dry', {
    alias: 'd',
    type: 'boolean',
    description: 'Only list contribution details without creating them'
  })
  .help()
  .version()
  .demandOption('start', 'Please provide a start date')
  .default('end', function now () {
    return (new Date()).toISOString().split('.')[0]+"Z";
  })
  .example([
    ['$0 --start 2020-11-01 --end 2020-11-30T23:59:59Z', 'Create contributions for reviews of pull requests merged in November 2020'],
    ['$0 --start 2021-01-01', 'Create contributions for reviews of pull requests merged from Januar 2021 until now'],
  ])
  .argv

const startTimestamp = Date.parse(argv.start);
const endTimestamp = Date.parse(argv.end);

if (isNaN(startTimestamp)) {
  console.log('The provided start date is invalid');
  process.exit(1);
}

if (isNaN(endTimestamp)) {
  console.log('The provided end date is invalid');
  process.exit(1);
}

// check for existence of GITHUB_TOKEN and GITEA_TOKEN
if (!process.env.GITHUB_TOKEN || !process.env.GITEA_TOKEN) {
  console.log('Please set both GITHUB_TOKEN and GITEA_TOKEN');
  process.exit(1);
}

const startDate = new Date(startTimestamp);
const endDate = new Date(endTimestamp);

async function getAllReviews(repos, startDate, endDate) {
  const githubReviews = new GithubReviews(process.env.GITHUB_TOKEN, kreditsAmounts);
  const giteaReviews = new GiteaReviews(process.env.GITEA_TOKEN, kreditsAmounts);

  return Promise.all([
    githubReviews.getReviewContributions(repos.github, startDate, endDate),
    giteaReviews.getReviewContributions(repos.gitea, startDate, endDate)
  ]).then(reviews => {
    return { github: reviews[0], gitea: reviews[1] }
  });
}

async function initializeKredits () {
  //
  // Ethereum wallet setup
  //

  let wallet;
  try {
    wallet = await ethers.Wallet.fromEncryptedJson(walletJson, process.env.KREDITS_WALLET_PASSWORD);
  } catch(error) {
    console.log('Could not load wallet:', error);
    process.exit(1);
  }

  //
  // Ethereum provider/node setup
  //

  let ethProvider;
  if (providerUrl) {
    ethProvider = new ethers.providers.JsonRpcProvider(providerUrl);
  } else {
    ethProvider = new ethers.getDefaultProvider('rinkeby');
  }
  const signer = new NonceManager(wallet.connect(ethProvider));

  //
  // Kredits contracts setup
  //

  const opts = { ipfsConfig };
  if (daoAddress) {
    opts.addresses = { Kernel: daoAddress };
  }
  let kredits;

  try {
    kredits = await new Kredits(signer.provider, signer, opts).init();
  } catch(error) {
    console.log('Could not set up kredits:', error);
    process.exit(1);
  }

  return kredits;
}

function createContribution(contributorName, contributionAttributes, Contribution) {
  console.log(`Creating contribution token for ${contributionAttributes.amount}₭S to ${contributorName} for ${contributionAttributes.description}...`);

  return Contribution.add(contributionAttributes).catch(error => {
    console.log(`I tried to add a contribution for ${contributorName}, but I encountered an error when submitting the tx:`);
    console.log(`Error:`, error);
    console.log('Contribution attributes:');
    console.log(util.inspect(contributionAttributes, { depth: 2, colors: true }));
  });
}

async function generateContributionData(reviews, Contributor, startDate, endDate) {
  const dateFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  const contributors = await Contributor.all();
  const contributionData = {};
  const now = (new Date()).toISOString().split('.')[0]+"Z";
  [date, time] = now.split('T');

  function addContributionDataForPlatform(platform) {
    for (const [username, platformReviews] of Object.entries(reviews[platform])) {
      const contributor = contributors.find(c => {
        return c[`${platform}_username`] === username;
      });

      if (!contributor) {
        console.log(`Could not find contributor for ${platform} user "${username}"`);
        continue;
      }

      const urls = platformReviews.map(review => review.pr.html_url);
      const kreditsAmount = platformReviews.reduce((amount, review) => {
        return review.kredits + amount;
      }, 0);

      if (typeof contributionData[contributor.name] !== 'undefined') {
        contributionData[contributor.name].amount += kreditsAmount;
        contributionData[contributor.name].details.pullRequests.push(...urls);
      } else {
        const formattedStartDate = startDate.toLocaleString('en-us', dateFormatOptions);
        const formattedEndDate = endDate.toLocaleString('en-us', dateFormatOptions);

        contributionData[contributor.name] = {
          contributorId: contributor.id,
          contributorIpfsHash: contributor.ipfsHash,
          date,
          time,
          amount: kreditsAmount,
          kind: 'dev',
          description: `PR reviews from ${formattedStartDate} to ${formattedEndDate}`,
          details: {
            'pullRequests': urls
          }
        }
      }
    }
  }

  addContributionDataForPlatform('gitea');
  addContributionDataForPlatform('github');

  return contributionData;
}

Promise.all([initializeKredits(), getAllReviews(repos, startDate, endDate)]).then((values) => {
  const kredits = values[0];
  const reviews = values[1];

  generateContributionData(reviews, kredits.Contributor, startDate, endDate).then(contributionData => {
    if (argv.dry) {
      console.log('Contributions:');
      console.log(util.inspect(contributionData, { depth: 3, colors: true }));
    } else {
      // create contributions
      for (const [username, contributionAttributes] of Object.entries(contributionData)) {
        createContribution(username, contributionAttributes, kredits.Contribution);
      }
    }
  });
});

