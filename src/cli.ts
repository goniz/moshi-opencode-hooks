#!/usr/bin/env bun

import { homedir } from "os"
import { dirname, resolve } from "path"

const TOKEN_PATH = `${homedir()}/.config/moshi/token`
const OPENCODE_CONFIG_PATH = `${homedir()}/.config/opencode/opencode.json`
const PLUGIN_SOURCE = resolve(import.meta.dirname, "..", "index.ts")
const HOOK_IDENTIFIER = "moshi-opencode-hooks"

async function loadConfig(): Promise<Record<string, unknown>> {
  try {
    const file = Bun.file(OPENCODE_CONFIG_PATH)
    if (!file.size) return {}
    return await file.json()
  } catch {
    return {}
  }
}

async function saveConfig(config: Record<string, unknown>): Promise<void> {
  const { mkdir } = await import("fs/promises")
  await mkdir(dirname(OPENCODE_CONFIG_PATH), { recursive: true })
  await Bun.write(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n")
}

function isMoshiHook(entry: string): boolean {
  return entry.includes(HOOK_IDENTIFIER) || entry.includes("moshi-opencode-hooks")
}

async function setup(): Promise<void> {
  const config = await loadConfig()
  const plugins: string[] = Array.isArray(config.plugin) ? config.plugin : []

  const filtered = plugins.filter((p) => !isMoshiHook(p))
  filtered.push(PLUGIN_SOURCE)

  config.plugin = filtered
  await saveConfig(config)
  console.log(`moshi-opencode-hooks: registered in ${OPENCODE_CONFIG_PATH}`)
}

async function uninstall(): Promise<void> {
  const config = await loadConfig()
  const plugins: string[] = Array.isArray(config.plugin) ? config.plugin : []

  const filtered = plugins.filter((p) => !isMoshiHook(p))
  config.plugin = filtered

  await saveConfig(config)
  console.log(`moshi-opencode-hooks: removed from ${OPENCODE_CONFIG_PATH}`)
}

async function setToken(value: string): Promise<void> {
  const { mkdir } = await import("fs/promises")
  await mkdir(dirname(TOKEN_PATH), { recursive: true })
  await Bun.write(TOKEN_PATH, value + "\n")
  console.log(`moshi-opencode-hooks: token saved to ${TOKEN_PATH}`)
}

async function getToken(): Promise<void> {
  try {
    const text = await Bun.file(TOKEN_PATH).text()
    console.log(text.trim() || `no token found (expected at ${TOKEN_PATH})`)
  } catch {
    console.log(`no token found (expected at ${TOKEN_PATH})`)
  }
}

async function main() {
  const subcommand = process.argv[2]

  if (subcommand === "setup") {
    await setup()
    return
  }

  if (subcommand === "uninstall") {
    await uninstall()
    return
  }

  if (subcommand === "token") {
    const value = process.argv[3]
    if (value) {
      await setToken(value)
    } else {
      await getToken()
    }
    return
  }

  console.log("Usage:")
  console.log("  moshi-opencode-hooks setup       Register plugin")
  console.log("  moshi-opencode-hooks uninstall   Remove plugin")
  console.log("  moshi-opencode-hooks token [value]  Show or set API token")
  process.exit(0)
}

main().catch((err) => {
  console.error(`moshi-opencode-hooks: error:`, err)
  process.exit(1)
})
