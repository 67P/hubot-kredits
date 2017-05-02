// Description:
//   Kosmos Kredits chat integration
//
// Configuration:
//   KREDITS_WEBHOOK_TOKEN: A string for building your secret webhook URL
//   KREDITS_ROOM: Kredit proposals are posted to this chatroom
//
// Authors:
//   Sebastian Kippe <sebastian@kip.pe>

// const fs = require('fs');
const fetch = require('node-fetch');

(function() {
  "use strict";

  module.exports = function(robot) {

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
      return new Promise((resolve/*, reject*/) => {
        // TODO write metaData to IPFS
        console.log(`Creating proposal to issue ${amount}₭S to ${recipient} for ${url}...`);

        // robot.messageRoom(process.env.KREDITS_ROOM, message);
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

    robot.router.post('/incoming/kredits/github/'+process.env.KREDITS_WEBHOOK_TOKEN, (req, res) => {
      let evt = req.header('X-GitHub-Event');
      let data = req.body;
      console.log(`Received GitHub hook. Event: ${evt}, action: ${data.action}`);

      if (evt === 'pull_request' && data.action === 'closed') {
        handleGitHubPullRequestClosed(data).then(() => res.send(200));
      }
      else if (evt === 'issues' && data.action === 'closed') {
        handleGitHubIssueClosed(data).then(() => res.send(200));
      }
    });

  };
}());
