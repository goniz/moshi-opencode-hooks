# moshi-opencode-hooks

OpenCode plugin that sends real-time events to the [Moshi](https://getmoshi.app) iOS app for live activity integration.

## Motivation

[Moshi](https://getmoshi.app) is an iOS SSH app that provides live activity widgets on the lock screen and Dynamic Island. While it already supports Cloud Code, this plugin brings the same live activity experience to [OpenCode](https://opencode.ai) users.

Track your coding session progress in real-time:
- See which tool is currently running
- Get notified when permissions are needed
- Know when your task completes

## Setup

```bash
# 1. Install the plugin (pulls from npm)
bunx moshi-opencode-hooks setup

# 2. Add your Moshi token
bunx moshi-opencode-hooks token YOUR_TOKEN_HERE
```

That's it! OpenCode will now send events to Moshi whenever you start a session or run a tool.

### Manual Setup

Add to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["moshi-opencode-hooks"]
}
```

## Requirements

- [OpenCode](https://opencode.ai)
- [Moshi iOS app](https://getmoshi.app) with Pro subscription

## Moshi Token

Get your token from the Moshi iOS app:
1. Open Moshi → Settings → Agent Hooks
2. Copy the hook token

## Uninstall

```bash
bunx moshi-opencode-hooks uninstall
```

## How It Works

The plugin hooks into OpenCode's plugin system and subscribes to session and tool events. When events occur, they're normalized and POSTed to the Moshi API endpoint, which pushes updates to your live activity.

## License

MIT
