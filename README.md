[![npm](https://img.shields.io/npm/v/hubot-kredits.svg)](https://www.npmjs.com/package/hubot-kredits)

# Hubot Kredits

This repository provides scripts for integrating [Kosmos
Kredits](https://wiki.kosmos.org/Kredits) in [Hubot](http://hubot.github.com/)
chatbots. The bot will watch for project-related things happening on the
Internet and automatically create ERC721 tokens for issuing kredits for project
contributions.

## Setup

You will need an Ethereum wallet for your bot, so it can interact with the
Ethereum smart contracts. `npm run create-wallet` will do the job for you.

## Configuration

As usual in Hubot, you can add all config as environment variables.

| Key | Description |
| --- | --- |
| `KREDITS_WEBHOOK_TOKEN` | A string for building your secret webhook URLs |
| `KREDITS_ROOM` | The bot will talk to you in this room |
| `KREDITS_WALLET_PATH` | Path to an Etherum wallet JSON file (default: `./wallet.json`) |
| `KREDITS_WALLET_PASSWORD` | Wallet password |
| `KREDITS_PROVIDER_URL` | Ethereum JSON-RPC URL (default: `http://localhost:7545`) |

## Integrations

### GitHub

The GitHub integration will watch for closed issues and merged pull requests,
which carry a kredits label: `kredits-1`, `kredits-2`, `kredits-3` for small,
medium and large contributions. If there are multiple people assigned, it will
issue contribution tokens for all of them.

#### Setup

Point a GitHub organization webhook to the following URL:

    https://your-hubot.example.com/incoming/kredits/github/{webhook_token}

#### Config

| Key | Description |
| --- | --- |
| `KREDITS_GITHUB_REPO_BLACKLIST` | Repos which you do not want to issue kredits for. Format: `orgname/reponame`, e.g. `67P/test-one-two` |

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
