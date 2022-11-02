[![npm](https://img.shields.io/npm/v/@kredits/hubot-kredits.svg)](https://www.npmjs.com/package/@kredits/hubot-kredits)

# Hubot Kredits

This repository provides scripts for integrating [Kosmos
Kredits](https://wiki.kosmos.org/Kredits) in [Hubot](http://hubot.github.com/)
chatbots. The bot will watch for project-related things happening on the
Internet and automatically create ERC721 tokens for issuing kredits for project
contributions.

## Setup

### Wallet

You will need a keypair/wallet for your bot, so it can interact with the smart
contracts. `npm run create-wallet` will do the job for you.

The wallet must be funded with enough native chain tokens to interact with the
contracts (i.e. it must be able to pay gas/tx fees)

### Contract permissions

**Warning: outdated instructions!**

*TODO adapt instructions for new permission model*

The bot wallet needs the following Aragon contract permissions to interact
with [kredits-contracts]:

1. `ADD_CONTRIBUTION_ROLE` on the `Contribution` contract
2. `MANAGE_CONTRIBUTORS_ROLE` on the `Contributor` contract

These permissions can be configured using the [Aragon
CLI](https://hack.aragon.org/docs/cli-intro.html) (see [kredits-contracts].

    aragon dao acl grant [DAO address] [contribution app address] ADD_CONTRIBUTION_ROLE [bot wallet address]
    aragon dao acl grant [DAO address] [contributor app address] MANAGE_CONTRIBUTORS_ROLE [bot wallet address]

To get the `Contribution` and `Contributor` app addresses use `aragon dao apps`.

## Configuration

As usual in Hubot, you can add all config as environment variables.

| Key | Description |
| --- | --- |
| `KREDITS_WEBHOOK_TOKEN` | A string for building your secret webhook URLs |
| `KREDITS_ROOM` | The bot will talk to you in this room |
| `KREDITS_WALLET_PATH` | Path to an wallet JSON file (default: `./wallet.json`) |
| `KREDITS_WALLET_PASSWORD` | Wallet password |
| `KREDITS_PROVIDER_URL` | JSON-RPC URL of a blockchain node (default: `http://localhost:7545`) |
| `KREDITS_WEB_URL` | URL of the Kredits Web app (default: `https://kredits.kosmos.org`) |
| `KREDITS_SESSION_SECRET` | Secret used by [grant](https://www.npmjs.com/package/grant) to sign the session ID |
| `KREDITS_GRANT_HOST` | Host used by [grant](https://www.npmjs.com/package/grant) to generate OAuth redirect URLs (default: `localhost:8888`) |
| `KREDITS_GRANT_PROTOCOL` | Protocol (http or https) used by [grant](https://www.npmjs.com/package/grant") to generate the OAuth redirect URLs (default: "http") |

## Integrations

### GitHub

The GitHub integration will watch for closed issues and merged pull requests,
which carry a kredits label: `kredits-1`, `kredits-2`, `kredits-3` for small,
medium and large contributions. If there are multiple people assigned, it will
issue contribution tokens for all of them.

If `KREDITS_GITHUB_KEY` and `KREDITS_GITHUB_SECRET` are set, the bot will also
expose OAuth endpoints to authenticate new contributors and register new
contributor profiles on the smart contract. For this feature, a [GitHub OAuth
app] is required and the [OAuth grant config variables](#Configuration) must be
set.

#### Setup

Point a GitHub organization webhook to the following URL:

    https://your-hubot.example.com/incoming/kredits/github/{webhook_token}

#### Config

| Key | Description |
| --- | --- |
| `KREDITS_GITHUB_REPO_BLACKLIST` | Repos which you do not want to issue kredits for. Format: `orgname/reponame`, e.g. `67P/test-one-two` |
| `KREDITS_GITHUB_KEY` | Key of the [GitHub OAuth app] used to authenticate contributors |
| `KREDITS_GITHUB_SECRET` | Secret of the [GitHub OAuth app] used to authenticate contributors |

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

[kredits-contracts]: https://github.com/67P/kredits-contracts
[GitHub OAuth app]: https://developer.github.com/apps/about-apps/#about-oauth-apps


### Zoom

The Zoom integration creates contributions for meeting participations.

Every meeting that is longer than 15 minutes and with more than 2 participants will be registered.
An optional meeting whitelist can be configured to create contributions only for specific meetings.


#### Setup

A Zoom JWT app has to be set up and an [event webhook subscription](https://marketplace.zoom.us/docs/api-reference/webhook-reference/meeting-events/meeting-ending")
on `meeting.ended` has to be configured to the following URL:

    https://your-hubot.example.com/incoming/kredits/zoom/{webhook_token}

#### Config

| Key | Description |
| --- | --- |
| `KREDITS_ZOOM_JWT` | The JWT for the Zoom application (required)
| `KREDITS_ZOOM_MEETING_WHITELIST` | Comma separated list of meeting names for which kredits should be tracked (optional)
| `KREDITS_ZOOM_CONTRIBUTION_AMOUNT` | The amount of kredits issued for each meeting. (default: 500)

[Zoom apps](https://marketplace.zoom.us/user/build)
