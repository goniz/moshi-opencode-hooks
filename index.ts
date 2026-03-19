import { homedir } from "os"
import { basename } from "path"
import type { Plugin } from "@opencode-ai/plugin"

const TOKEN_PATH = `${homedir()}/.config/moshi/token`
const API_URL = "https://api.getmoshi.app/api/v1/agent-events"
const INTERESTING_TOOLS = new Set(["bash", "edit", "write", "read", "glob", "grep", "task"])

interface HookState {
  model?: string
  lastToolName?: string
  lastStopTime?: number
  sessionStartTime?: number
}

interface AgentEvent {
  source: "opencode"
  eventType: "user_prompt" | "pre_tool" | "post_tool" | "notification" | "stop" | "agent_turn_complete"
  sessionId: string
  category: "approval_required" | "task_complete" | "tool_running" | "tool_finished" | "info" | "error"
  title: string
  message: string
  eventId: string
  projectName?: string
  modelName?: string
  toolName?: string
  contextPercent?: number
}

function statePath(sessionId: string): string {
  return `/tmp/moshi-opencode-hook-${sessionId}.json`
}

async function readState(sessionId: string): Promise<HookState> {
  try {
    const file = Bun.file(statePath(sessionId))
    if (!file.size) return {}
    return await file.json()
  } catch {
    return {}
  }
}

async function writeState(sessionId: string, patch: Partial<HookState>): Promise<void> {
  const existing = await readState(sessionId)
  await Bun.write(statePath(sessionId), JSON.stringify({ ...existing, ...patch }))
}

async function loadToken(): Promise<string | null> {
  try {
    const text = await Bun.file(TOKEN_PATH).text()
    return text.trim() || null
  } catch {
    return null
  }
}

async function sendEvent(token: string, event: AgentEvent): Promise<void> {
  const body = JSON.stringify(event)
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok && res.status >= 500) {
      console.error(`[moshi-hooks] API error: ${res.status}`)
    }
  } catch (err) {
    console.error(`[moshi-hooks] Failed to send event:`, err)
  }
}

function formatToolName(toolName: string): string {
  return toolName.charAt(0).toUpperCase() + toolName.slice(1)
}

export const MoshiHooks: Plugin = async ({ client, directory }) => {
  const setupEventSubscription = async () => {
    try {
      const events = await client.event.subscribe()
      for await (const event of events.stream) {
        const token = await loadToken()
        if (!token) break

        const sessionId = (event as any).sessionId ?? "unknown"
        const projectName = directory ? basename(directory) : undefined
        const state = await readState(sessionId)

        if (event.type === "session.created") {
          await writeState(sessionId, {
            sessionStartTime: Date.now() / 1000,
            model: (event as any).properties?.model,
          })
          continue
        }

        if (event.type === "session.idle") {
          const now = Date.now() / 1000
          if (state.lastStopTime && now - state.lastStopTime < 5) continue

          await writeState(sessionId, { lastStopTime: now })

          const evt: AgentEvent = {
            source: "opencode",
            eventType: "stop",
            sessionId,
            category: "task_complete",
            title: "Task Complete",
            message: "",
            eventId: crypto.randomUUID(),
            projectName,
            modelName: state.model,
            toolName: state.lastToolName,
          }
          await sendEvent(token, evt)
        }
      }
    } catch (err) {
      console.error(`[moshi-hooks] Event subscription error:`, err)
    }
  }

  setupEventSubscription()

  return {
    "tool.execute.before": async (input, _output) => {
      const token = await loadToken()
      if (!token) return

      const { tool, sessionID } = input
      if (!tool || !INTERESTING_TOOLS.has(tool.toLowerCase())) return

      await writeState(sessionID, { lastToolName: tool })

      const state = await readState(sessionID)
      const projectName = directory ? basename(directory) : undefined

      const evt: AgentEvent = {
        source: "opencode",
        eventType: "pre_tool",
        sessionId: sessionID,
        category: "tool_running",
        title: `Running ${formatToolName(tool)}`,
        message: "",
        eventId: crypto.randomUUID(),
        projectName,
        modelName: state.model,
        toolName: tool,
      }
      await sendEvent(token, evt)
    },

    "tool.execute.after": async (input, output) => {
      const token = await loadToken()
      if (!token) return

      const { tool, sessionID } = input
      if (!tool || !INTERESTING_TOOLS.has(tool.toLowerCase())) return

      const state = await readState(sessionID)
      const projectName = directory ? basename(directory) : undefined

      const evt: AgentEvent = {
        source: "opencode",
        eventType: "post_tool",
        sessionId: sessionID,
        category: "tool_finished",
        title: `Finished ${formatToolName(tool)}`,
        message: "",
        eventId: crypto.randomUUID(),
        projectName,
        modelName: state.model,
        toolName: tool,
      }
      await sendEvent(token, evt)
    },

    "permission.ask": async (input, output) => {
      const token = await loadToken()
      if (!token) return

      const sessionID = (input as any).sessionID ?? "unknown"
      const state = await readState(sessionID)
      const projectName = directory ? basename(directory) : undefined

      const prompt = (input as any).prompt ?? ""

      const evt: AgentEvent = {
        source: "opencode",
        eventType: "notification",
        sessionId: sessionID,
        category: "approval_required",
        title: "Permission Required",
        message: prompt.slice(0, 256),
        eventId: crypto.randomUUID(),
        projectName,
        modelName: state.model,
      }
      await sendEvent(token, evt)
    },
  }
}
