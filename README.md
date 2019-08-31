[![npm](https://img.shields.io/npm/v/hubot-kredits.svg)](https://www.npmjs.com/package/hubot-kredits)

# Hubot Kredits

This repository provides scripts for integrating [Kosmos
Kredits](https://wiki.kosmos.org/Kredits) in [Hubot](http://hubot.github.com/)
chatbots. The bot will watch for project-related things happening on the
Internet and automatically create ERC721 tokens for issuing kredits for project
contributions.

## Setup

## Ethereum Wallet

You will need an Ethereum wallet for your bot, so it can interact with the
Ethereum smart contracts. `npm run create-wallet` will do the job for you.
That wallet must be funded with enough ETH to interact with the contracts.

### Contract permissions

The bot wallet needs the following aragon contract permissions to interact
with [kredits-contracts](https://github.com/67P/kredits-contracts)

1. `ADD_CONTRIBUTION_ROLE` on the Contribution contract
2. `MANAGE_CONTRIBUTORS_ROLE` on the Contributor contract (used for registering contributors)

These permissions can be configured using the `aragon-cli` (see [kredits-contracts](https://github.com/67P/kredits-contracts).

 $ aragon dao acl grant [your DAO address] [your contribution app address] ADD_CONTRIBUTION_ROLE [bot wallet address]
 $ aragon dao acl grant [your DAO address] [your contributor app address] MANAGE_CONTRIBUTORS_ROLE [bot wallet address]

To get the contribution and contributor app address use `aragon dao apps`


## Configuration

As usual in Hubot, you can add all config as environment variables.

| Key | Description |
| --- | --- |
| `KREDITS_WEBHOOK_TOKEN` | A string for building your secret webhook URLs |
| `KREDITS_ROOM` | The bot will talk to you in this room |
| `KREDITS_WALLET_PATH` | Path to an Etherum wallet JSON file (default: `./wallet.json`) |
| `KREDITS_WALLET_PASSWORD` | Wallet password |
| `KREDITS_PROVIDER_URL` | Ethereum JSON-RPC URL (default: `http://localhost:7545`) |
| `KREDITS_WEB_URL` | URL of the Kredits Web app (default: `https://kredits.kosmos.org`) |
| `KREDITS_DAO_ADDRESS` | DAO Kernel address |
| `KREDITS_SESSION_SECRET` | Secret used by [grant](https://www.npmjs.com/package/grant) to sign the Session ID |
| `KREDITS_GRANT_HOST` | Host used by [grant](https://www.npmjs.com/package/grant) to generate OAuth redirect URLs (default: `localhost:8888`) |
| `KREDITS_GRANT_PROTOCOL` | Protocol (http or https) used by [grant](https://www.npmjs.com/package/grant") to generate the OAuth redirect URLs (default: "http") |

## Integrations

### GitHub

The GitHub integration will watch for closed issues and merged pull requests,
which carry a kredits label: `kredits-1`, `kredits-2`, `kredits-3` for small,
medium and large contributions. If there are multiple people assigned, it will
issue contribution tokens for all of them.

If `KREDITS_GITHUB_KEY` and `KREDITS_GITHUB_SECRET` are set it will also expose
OAuth endpoints to authenticate new contributors and register new profiles on 
the smart contract. For this a [GitHub app](https://developer.github.com/apps/about-apps/) 
is required and the [OAuth grant config](#Configuration) must set.

#### Setup

Point a GitHub organization webhook to the following URL:

    https://your-hubot.example.com/incoming/kredits/github/{webhook_token}

#### Config

| Key | Description |
| --- | --- |
| `KREDITS_GITHUB_REPO_BLACKLIST` | Repos which you do not want to issue kredits for. Format: `orgname/reponame`, e.g. `67P/test-one-two` |
| `KREDITS_GITHUB_KEY` | Key of the [GitHub app](https://developer.github.com/apps/building-github-apps/creating-a-github-app/) used to authenticate new collaborators |
| `KREDITS_GITHUB_SECRET` | Secret of the [GitHub app]((https://developer.github.com/apps/building-github-apps/creating-a-github-app/) used to authenticate new collaborators |

### Gitea

The Gitea integration will watch for closed issues and merged pull requests,
which carry a kredits label: `kredits-1`, `kredits-2`, `kredits-3` for small,
medium and large contributions. If there are multiple people assigned, it will
issue contribution tokens for all of them.

#### Setup

Point a Gitea organization webhook to the following URL:

    https://your-hubot.example.com/incoming/kredits/gitea/{webhook_token}

#### Config

| Key | Description |
| --- | --- |
| `KREDITS_GITEA_REPO_BLACKLIST` | Repos which you do not want to issue kredits for. Format: `orgname/reponame`, e.g. `kosmos/test-one-two` |

### MediaWiki

The MediaWiki integration will periodically check for wiki page creations and
edits. It will create kredits contribution tokens based on amount of text added.

#### Setup

No setup needed, except for configuring the wiki URL. The bot will poll your
wiki's API on its own.

#### Config

| Key | Description |
| --- | --- |
| `KREDITS_MEDIAWIKI_URL` | Your wiki URL, e.g. `https://wiki.kosmos.org/` |
