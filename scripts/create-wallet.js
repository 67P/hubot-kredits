#!/usr/bin/env node

const fs = require('fs');
const ethers = require('ethers');
const userPrompt = require('prompt');

let schema = {
  properties: {
    path: {
      required: true,
      default: 'wallet.json'
    },
    password: {
      hidden: true,
      required: true
    }
  }
};

console.log(`You're about to create an Ethereum wallet. Please provide a path and password for encryption.\n`);

userPrompt.start();

userPrompt.get(schema, (err, result) => {
  if (err) { throw(err); }

  let wallet = ethers.Wallet.createRandom();
  wallet.encrypt(result.password).then((walletJSON) => {
    fs.writeFileSync(result.path, walletJSON);
    console.log(`\nWrote encrypted wallet config to ${result.path}`);
  });

});
