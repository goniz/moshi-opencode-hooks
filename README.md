# moshi-opencode-hooks

OpenCode plugin for Moshi live activity integration. Provides real-time progress updates in the Moshi iOS app when using OpenCode.

## Setup

1. **Install the token** (if not already done with Claude Code):
   ```bash
   bunx moshi-hooks token Xjqyek7li0vXgBnIlvXEn3VJgdhWf8qW
   ```

2. **Add as npm plugin** in `~/.config/opencode/opencode.json`:
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["moshi-opencode-hooks"]
   }
   ```

   Or use a local path for development:
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["/path/to/moshi-opencode-hooks"]
   }
   ```

## Events Sent to Moshi

- `tool.execute.before/after` - Tool execution (Bash, Edit, Write, Read, Glob, Grep, Task)
- `permission.ask` - Permission prompts
- `session.created` - Session start
- `session.idle` - Task completion

## Requirements

- OpenCode
- Moshi iOS app with Cloud Code hook token
