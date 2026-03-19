import { homedir } from "os"
import { basename } from "path"
import type { Plugin } from "@opencode-ai/plugin"

const TOKEN_PATH = `${homedir()}/.config/moshi/token`
const API_URL = "https://api.getmoshi.app/api/v1/agent-events"
const INTERESTING_TOOLS = new Set(["bash", "edit", "write", "read", "glob", "grep", "task", "question", "apply_patch", "webfetch", "websearch"])

interface AgentEvent {
  source: "opencode"
  eventType: "pre_tool" | "post_tool" | "notification" | "stop"
  sessionId: string
  category: "approval_required" | "task_complete" | "tool_running" | "tool_finished"
  title: string
  message: string
  eventId: string
  projectName?: string
  modelName?: string
  toolName?: string
  contextPercent?: number
}

async function loadToken(): Promise<string | null> {
  try {
    const text = await Bun.file(TOKEN_PATH).text()
    return text.trim() || null
  } catch {
    return null
  }
}

async function logPluginEvent(
  client: Parameters<Plugin>[0]["client"],
  level: "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await client.app.log({
      body: {
        service: "moshi-hooks",
        level,
        message,
        extra,
      },
    })
  } catch (err) {
    console.error(`[moshi-hooks] ${message}`, err)
  }
}

async function sendEvent(token: string, event: AgentEvent): Promise<Response> {
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
    return res
  } catch (err) {
    throw err
  }
}

async function getModel(client: Parameters<Plugin>[0]["client"], sessionId: string): Promise<string | undefined> {
  try {
    const res = await (client.session.get as any)({ sessionID: sessionId })
    return res.data?.model
  } catch {
    return undefined
  }
}

async function getOrLoadModel(
  client: Parameters<Plugin>[0]["client"],
  sessionId: string,
): Promise<string | undefined> {
  return await getModel(client, sessionId)
}

async function sendAgentEvent(
  client: Parameters<Plugin>[0]["client"],
  token: string,
  event: AgentEvent,
): Promise<void> {
  try {
    const res = await sendEvent(token, event)
    if (!res.ok && res.status >= 500) {
      await logPluginEvent(client, "error", "Moshi API returned server error", {
        status: res.status,
        eventType: event.eventType,
        sessionId: event.sessionId,
      })
    }
  } catch (err) {
    await logPluginEvent(client, "error", "Failed to send Moshi event", {
      error: err instanceof Error ? err.message : String(err),
      eventType: event.eventType,
      sessionId: event.sessionId,
    })
  }
}

function formatToolName(toolName: string): string {
  return toolName.charAt(0).toUpperCase() + toolName.slice(1)
}

function formatModelName(model: string | undefined): string | undefined {
  if (!model) return undefined
  return model.split("/").pop()
}

async function getContextPercent(sessionId: string, client: Parameters<Plugin>[0]["client"]): Promise<number | undefined> {
  try {
    const sessionRes = await client.session.get({ path: { id: sessionId } })
    const sessionData = (sessionRes as any).data
    if (!sessionData) return undefined

    const model = sessionData.model as { limit?: { context?: number } } | undefined
    const contextLimit = model?.limit?.context
    if (!contextLimit) return undefined

    const messagesRes = await client.session.messages({ path: { id: sessionId }, query: { limit: 1 } })
    const messagesData = (messagesRes as any).data
    const messages = messagesData?.messages ?? messagesData
    const lastMsg = Array.isArray(messages) ? messages[messages.length - 1] : messages
    if (!lastMsg?.tokens?.input) return undefined

    const totalInputTokens = lastMsg.tokens.input
    return Math.min(100, Math.round((totalInputTokens / contextLimit) * 100))
  } catch {
  }
  return undefined
}

const pkg = await import("./package.json", { assert: { type: "json" } })
const VERSION = pkg.default.version

export const MoshiHooks: Plugin = async ({ client, directory }) => {
  setTimeout(() => {
    client.tui.showToast({
      body: {
        message: `moshi-opencode-hooks v${VERSION} is active`,
        variant: "info",
      },
    })
  }, 5000)

  const setupEventSubscription = async () => {
    try {
      const events = await client.event.subscribe()
      for await (const event of events.stream) {
        const token = await loadToken()
        if (!token) continue

        const sessionId = (event as any).sessionId ?? "unknown"
        const projectName = directory ? basename(directory) : undefined

        if (event.type === "session.idle") {
          if (await isSubagentSession(sessionId)) continue

          const evt: AgentEvent = {
            source: "opencode",
            eventType: "stop",
            sessionId,
            category: "task_complete",
            title: "Task Complete",
            message: "",
            eventId: crypto.randomUUID(),
            projectName,
            modelName: formatModelName(await getOrLoadModel(client, sessionId)),
            contextPercent: await getContextPercent(sessionId, client),
          }
          await sendAgentEvent(client, token, evt)
        }
      }
    } catch (err) {
      await logPluginEvent(client, "error", "Event subscription error", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  setupEventSubscription()

  const isSubagentSession = async (sessionID: string): Promise<boolean> => {
    try {
      const res = await (client.session.get as any)({ sessionID })
      return !!(res.data?.parentID)
    } catch {
      return false
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      const token = await loadToken()
      if (!token) return

      const { tool, sessionID } = input
      if (!tool || !INTERESTING_TOOLS.has(tool.toLowerCase())) return
      if (await isSubagentSession(sessionID)) return

      const projectName = directory ? basename(directory) : undefined

      if (tool === "question") {
        const questions: any[] = output.args?.questions ?? []
        const lines = questions.map((q) => {
          const opts = q.options?.map((o: any) => `  - ${o.label}`).join("\n") ?? ""
          return `${q.header}: ${q.question}\n${opts}`
        })
        const evt: AgentEvent = {
          source: "opencode",
          eventType: "notification",
          sessionId: sessionID,
          category: "approval_required",
          title: "Question",
          message: lines.join("\n---\n").slice(0, 512),
          eventId: crypto.randomUUID(),
          projectName,
          modelName: formatModelName(await getOrLoadModel(client, sessionID)),
          toolName: tool,
          contextPercent: await getContextPercent(sessionID, client),
        }
        await sendAgentEvent(client, token, evt)
        return
      }

      const evt: AgentEvent = {
        source: "opencode",
        eventType: "pre_tool",
        sessionId: sessionID,
        category: "tool_running",
        title: `Running ${formatToolName(tool)}`,
        message: "",
        eventId: crypto.randomUUID(),
        projectName,
        modelName: formatModelName(await getOrLoadModel(client, sessionID)),
        toolName: tool,
        contextPercent: await getContextPercent(sessionID, client),
      }
      await sendAgentEvent(client, token, evt)
    },

    "tool.execute.after": async (input, output) => {
      const token = await loadToken()
      if (!token) return

      const { tool, sessionID } = input
      if (!tool || !INTERESTING_TOOLS.has(tool.toLowerCase())) return
      if (await isSubagentSession(sessionID)) return

      if (tool === "question") return

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
        modelName: formatModelName(await getOrLoadModel(client, sessionID)),
        toolName: tool,
        contextPercent: await getContextPercent(sessionID, client),
      }
      await sendAgentEvent(client, token, evt)
    },

    "permission.asked": async (input: any, _output: any) => {
      const token = await loadToken()
      if (!token) return

      const sessionID = (input as any).sessionID ?? "unknown"
      if (await isSubagentSession(sessionID)) return

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
        modelName: formatModelName(await getOrLoadModel(client, sessionID)),
        contextPercent: await getContextPercent(sessionID, client),
      }
      await sendAgentEvent(client, token, evt)
    },
  }
}
