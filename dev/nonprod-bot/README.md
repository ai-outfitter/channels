# Bolt for JavaScript Blank Template

This is a blank [Bolt for JavaScript](https://docs.slack.dev/tools/bolt-js/) template app used to start building new Slack apps.

## Setup

Before getting started, make sure you have a development workspace where you have permissions to install apps. If you don't have one setup, go ahead and [create one](https://slack.com/create).

### Developer Program

Join the [Slack Developer Program](https://api.slack.com/developer-program) for exclusive access to sandbox environments for building and testing your apps, tooling, and resources created to help you build and grow.

## Installation

<details><summary><strong>Using Slack CLI</strong></summary>

Install the latest version of the Slack CLI for your operating system:

- [Slack CLI for macOS & Linux](https://docs.slack.dev/tools/slack-cli/guides/installing-the-slack-cli-for-mac-and-linux/)
- [Slack CLI for Windows](https://docs.slack.dev/tools/slack-cli/guides/installing-the-slack-cli-for-windows/)

You'll also need to log in if this is your first time using the Slack CLI.

```sh
slack login
```

#### Initializing the project

```sh
slack create my-bolt-js-app --template slack-samples/bolt-js-blank-template
cd my-bolt-js-app
```

After cloning, you're all set to start developing!

</details>

<details><summary><strong>Using Terminal</strong></summary>

#### Create Your Slack App

1. Open [https://api.slack.com/apps/new](https://api.slack.com/apps/new) and choose "From an app manifest"
2. Choose the workspace you want to install the application to
3. Copy the contents of [manifest.json](./manifest.json) into the text box that says `*Paste your manifest code here*` (within the JSON tab) and click _Next_
4. Review the configuration and click _Create_
5. Click _Install to Workspace_ and _Allow_ on the screen that follows. You'll then be redirected to the App Configuration dashboard.

#### Environment Variables

Before you can run the app, you'll need to store some environment variables.

1. Rename `.env.sample` to `.env`
2. Open your apps configuration page from [this list](https://api.slack.com/apps), click _OAuth & Permissions_ in the left hand menu, then copy the _Bot User OAuth Token_ into your `.env` file under `SLACK_BOT_TOKEN`
3. Click _Basic Information_ from the left hand menu and follow the steps in the _App-Level Tokens_ section to create an app-level token with the `connections:write` scope. Copy that token into your `.env` as `SLACK_APP_TOKEN`.

#### Initializing the project

```sh
git clone https://github.com/slack-samples/bolt-js-blank-template.git my-bolt-js-app
cd my-bolt-js-app
```

#### Install dependencies

```sh
npm install
```

</details>

## Development

### Starting the app

#### Slack CLI

```sh
slack run
```

#### Terminal

```sh
npm start
```

### Linting

```zsh
# Run lint for code formatting and linting
npm run lint
```

### Testing

```zsh
# Run test for unit tests
npm test
```

## Resources

To learn more about developing Slack apps, visit the following pages:

- [API docs](https://docs.slack.dev)
- [Bolt for JavaScript docs](https://docs.slack.dev/tools/bolt-js/)
