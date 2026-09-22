#!/usr/bin/env bun
/**
 * Builds the offline dictionary snapshot the lookup plugin reads.
 *
 *   bun build-db.ts                    # download ECDICT and rebuild (~325 MB)
 *   bun build-db.ts /path/stardict.db  # rebuild from an existing ECDICT sqlite
 *
 * Source: ECDICT by skywind3000 (https://github.com/skywind3000/ECDICT), MIT.
 * GitHub is not always reachable directly, so the download goes through
 * gh-proxy.com; pass a local file to skip the network entirely.
 *
 * The output keeps only the columns a card needs, which shrinks 851 MB to ~325 MB.
 */
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const VERSION = "1.0.28"
const MIRROR = "https://gh-proxy.com/"
const ASSET = `https://github.com/skywind3000/ECDICT/releases/download/${VERSION}/ecdict-sqlite-28.zip`
const WORK = "/tmp/opencode/ecdict-build"
const OUT = process.env.OPENCODE_LOOKUP_DB || join(homedir(), ".local", "share", "lookup", "dict.db")

async function resolveSource(): Promise<string> {
  const given = process.argv[2]
  if (given) {
    if (!existsSync(given)) throw new Error(`no such file: ${given}`)
    return given
  }
  mkdirSync(WORK, { recursive: true })
  const db = join(WORK, "stardict.db")
  if (existsSync(db)) return db
  const zip = join(WORK, "ecdict.zip")
  console.log(`downloading ${MIRROR}${ASSET}`)
  const response = await fetch(MIRROR + ASSET)
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
  await Bun.write(zip, response)
  const unzip = Bun.spawnSync(["unzip", "-o", zip, "-d", WORK])
  if (unzip.exitCode !== 0) throw new Error(`unzip failed: ${unzip.stderr.toString()}`)
  if (!existsSync(db)) throw new Error("the archive did not contain stardict.db")
  return db
}

function phonetic(value: string | null): string | null {
  return value ? value.replaceAll("\u04d9", "\u0259").replaceAll(":", "\u02d0") : value
}

const source = await resolveSource()
console.log(`source: ${source}`)
const from = new Database(source, { readonly: true })

mkdirSync(join(OUT, ".."), { recursive: true })
await Bun.write(OUT, "")
const to = new Database(OUT)
to.run("PRAGMA journal_mode=OFF")
to.run("PRAGMA synchronous=OFF")
to.run(`CREATE TABLE entry (
  word TEXT NOT NULL,
  phonetic TEXT,
  translation TEXT,
  definition TEXT,
  pos TEXT,
  collins INTEGER,
  oxford INTEGER,
  tag TEXT,
  bnc INTEGER,
  frq INTEGER,
  exchange TEXT
)`)
const insert = to.prepare("INSERT INTO entry VALUES (?,?,?,?,?,?,?,?,?,?,?)")
const rows = from.query(`SELECT word, phonetic, translation, definition, pos, collins, oxford, tag, bnc, frq, exchange
FROM stardict
WHERE (translation IS NOT NULL AND translation <> '') OR (definition IS NOT NULL AND definition <> '')`)

let count = 0
to.transaction(() => {
  for (const row of rows.iterate() as Iterable<Record<string, never>>) {
    insert.run(
      row.word,
      phonetic(row.phonetic),
      row.translation,
      row.definition,
      row.pos,
      row.collins,
      row.oxford,
      row.tag,
      row.bnc,
      row.frq,
      row.exchange,
    )
    count++
  }
})()
to.run("CREATE INDEX idx_word ON entry (word COLLATE NOCASE)")
console.log(`wrote ${count} entries to ${OUT}`)
