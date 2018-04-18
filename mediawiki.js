#!/usr/bin/env node

const util = require('util');
const fetch = require('node-fetch');
const groupArray = require('group-array');

if (typeof process.env.KREDITS_MEDIAWIKI_URL === 'undefined') { return false; }
const apiURL =  process.env.KREDITS_MEDIAWIKI_URL + 'api.php';

const robot = {
  data: {},
  brain: {
    set(key, value) {
      this.data[key] = value;
    },
    get(key) {
      return this.data[key];
    }
  }
};

function fetchChanges () {
  const params = [
    'action=query',
    'format=json',
    'list=recentchanges',
    'rctype=edit|new',
    'rcshow=!minor|!bot|!anon|!redirect',
    'rclimit=max',
    'rcprop=ids|title|timestamp|user|sizes|comment|flags'
  ];

  const url = `${apiURL}?${params.join('&')}`;

  return fetch(url).then(res => {
    if (res.status === 200) {
      return res.json();
    } else {
      console.log(`Fetching ${url} returned HTTP status ${res.status}:`);
      console.log(res.body);
      throw Error('Unexpected response from '+url);
    }
  }).then(res => {
    return res.query.recentchanges;
  });
}

function groupChangesByUser (changes) {
  return groupArray(changes, 'user');
}

function analyzeUserChanges (user, changes) {
  console.log(`Analyzing ${changes.length} edits from ${user} ...`);
  const results = {};

  results.pagesCreated = changes.filter(c => c.type === 'new');
  results.pagesChanged = changes.filter(c => c.type === 'edit');
  results.linesAdded = changes
    .map(c => { return (c.oldlen < c.newlen) ? (c.newlen - c.oldlen) : 0; })
    .reduce((a, b) => a + b);

  console.log(`Created ${results.pagesCreated.length} pages`);
  console.log(`Edited ${results.pagesChanged.length} pages`);
  console.log(`Added ${results.linesAdded} lines of text\n`);

  return results;
}

function createProposalForUserChanges (user, changes) {
  const details = analyzeUserChanges(user, changes);

  // console.log(util.inspect(details));
}

fetchChanges()
  .then(res => groupChangesByUser(res))
  .then(res => {
    Object.keys(res).forEach(user => createProposalForUserChanges(user, res[user]));
  });
