#!/usr/bin/env node

const fs = require('fs');
const Wallet = require('ethereumjs-wallet');
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

  let wallet = Wallet.generate();
  let content = JSON.stringify(wallet.toV3(result.password));

  fs.writeFileSync(result.path, content);

  console.log(`\nWrote encrypted wallet config to ${result.path}`);
});
