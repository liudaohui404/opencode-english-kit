/**
 * Unpacks a zip file with whatever the platform provides.
 *
 * Linux and macOS have `unzip`. Windows does not, but it ships `tar` (bsdtar,
 * which reads zip files) and PowerShell's `Expand-Archive`. The first tool that
 * exists *and* produces the file we expect wins, so a half-working extractor
 * does not stop the chain.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"

export type Extractor = "unzip" | "tar" | "powershell" | "pwsh"

const SHELL_FLAGS = ["-NoProfile", "-NonInteractive", "-Command"]

function expandArchive(zip: string, dir: string): string[] {
  return [...SHELL_FLAGS, `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`]
}

/** Extracts `zip` into `dir` and returns the tool that worked. */
export function extractArchive(zip: string, dir: string, wanted = "stardict.db"): Extractor {
  const attempts: Array<[Extractor, string[]]> = [
    ["unzip", ["-o", zip, "-d", dir]],
    ["tar", ["-xf", zip, "-C", dir]],
    ["powershell", expandArchive(zip, dir)],
    ["pwsh", expandArchive(zip, dir)],
  ]

  const tried: string[] = []
  for (const [command, argv] of attempts) {
    if (!Bun.which(command)) continue
    tried.push(command)
    const result = Bun.spawnSync([command, ...argv])
    if (result.exitCode === 0 && existsSync(join(dir, wanted))) return command
  }

  throw new Error(
    tried.length
      ? `could not unpack ${zip} (tried: ${tried.join(", ")})`
      : "no unpacker found — need unzip, tar, or PowerShell",
  )
}
