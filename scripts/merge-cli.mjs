#!/usr/bin/env node
/**
 * Registers ./plugins/lookup in cli.json without touching any other setting.
 *
 *   node merge-cli.mjs [path/to/cli.json]
 *
 * The file is plain JSON. If it does not exist yet, it is created.
 * If the lookup entry already exists, its options are preserved.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const target = process.argv[2] ?? join(homedir(), ".config", "opencode", "cli.json")
const entry = { package: "./plugins/lookup", options: {} }

let config = {}
if (existsSync(target)) {
  const raw = readFileSync(target, "utf8").trim()
  if (raw) {
    try {
      config = JSON.parse(raw)
    } catch (error) {
      console.error(`cli.json is not valid JSON, leaving it alone: ${error.message}`)
      process.exit(1)
    }
  }
}

const plugins = Array.isArray(config.plugins) ? config.plugins : []
const index = plugins.findIndex((item) => item && item.package === entry.package)

if (index >= 0) {
  plugins[index] = { ...plugins[index], ...entry, options: plugins[index].options ?? entry.options }
  console.log("updated the existing ./plugins/lookup entry")
} else {
  plugins.push(entry)
  console.log("added the ./plugins/lookup entry")
}

config.plugins = plugins
writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`)
console.log(`wrote ${target} (${plugins.length} plugin entries)`)
