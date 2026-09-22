#!/usr/bin/env python3
"""Registers ./plugins/lookup in cli.json without touching any other setting.

    python3 merge-cli.py [path/to/cli.json]

Same behaviour as merge-cli.mjs. This exists because a machine with OpenCode
installed may still have no Node.js and no Bun, since the official installer
ships a standalone binary.
"""
import json
import os
import sys

target = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.path.join(os.path.expanduser("~"), ".config", "opencode", "cli.json")
)
entry = {"package": "./plugins/lookup", "options": {}}

config = {}
if os.path.exists(target):
    with open(target, encoding="utf-8") as handle:
        raw = handle.read().strip()
    if raw:
        try:
            config = json.loads(raw)
        except json.JSONDecodeError as error:
            print(f"cli.json is not valid JSON, leaving it alone: {error}", file=sys.stderr)
            sys.exit(1)

plugins = config.get("plugins")
if not isinstance(plugins, list):
    plugins = []

for item in plugins:
    if isinstance(item, dict) and item.get("package") == entry["package"]:
        item.setdefault("options", entry["options"])
        print("updated the existing ./plugins/lookup entry")
        break
else:
    plugins.append(entry)
    print("added the ./plugins/lookup entry")

config["plugins"] = plugins
with open(target, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
print(f"wrote {target} ({len(plugins)} plugin entries)")
