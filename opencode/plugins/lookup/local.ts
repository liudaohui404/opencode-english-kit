/**
 * Offline dictionary backend.
 *
 * Data: ECDICT (https://github.com/skywind3000/ECDICT, MIT) — a free
 * English→Chinese dictionary kept as a local SQLite file. A lookup opens that
 * file read-only and queries it, so there is no network call, no API key and no
 * rate limit. Nothing is sent to the model either.
 *
 * Rebuild the snapshot with `bun build-db.ts` (see build-db.ts and README.md).
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { shorten, type Card } from "./card"

export interface Entry {
  readonly word: string
  readonly phonetic: string | null
  readonly translation: string | null
  readonly definition: string | null
  readonly pos: string | null
  readonly collins: number | null
  readonly oxford: number | null
  readonly tag: string | null
  readonly bnc: number | null
  readonly frq: number | null
  readonly exchange: string | null
}

const DEFAULT_PATH = join(homedir(), ".local", "share", "lookup", "dict.db")

const SELECT = `SELECT word, phonetic, translation, definition, pos, collins, oxford, tag, bnc, frq, exchange
FROM entry WHERE word = ? COLLATE NOCASE LIMIT 1`

/** The slice of `bun:sqlite` this module uses, so typing does not need bun-types. */
interface Statement {
  get(...params: unknown[]): unknown
}
interface Handle {
  readonly db: Database
  readonly statement: Statement
}

let cached: Handle | null | undefined

export function dictionaryPath(): string {
  return process.env.OPENCODE_LOOKUP_DB || DEFAULT_PATH
}

/** Opens the file once and remembers the result. `undefined` means "not tried yet". */
function backend(): Handle | null {
  if (cached !== undefined) return cached
  try {
    const path = dictionaryPath()
    if (!existsSync(path)) {
      cached = null
      return cached
    }
    const db = new Database(path, { readonly: true })
    cached = { db, statement: db.query(SELECT) as unknown as Statement }
  } catch {
    cached = null
  }
  return cached
}

/** True when the local snapshot is present and readable. */
export function offlineReady(): boolean {
  return backend() !== null
}

export function closeDictionary(): void {
  if (cached) cached.db.close()
  cached = undefined
}

/** Turns the raw query into the few forms worth trying. */
export function candidates(word: string): string[] {
  const cleaned = word
    .trim()
    .replace(/^[\s"'“”‘’([{]+/, "")
    .replace(/[\s"'“”‘’)\]}]+$/, "")
    .trim()
  if (!cleaned) return []
  const out = [cleaned]
  if (cleaned.endsWith("'s") || cleaned.endsWith("’s")) out.push(cleaned.slice(0, -2))
  if (cleaned.endsWith("s'") || cleaned.endsWith("s’")) out.push(cleaned.slice(0, -1))
  return [...new Set(out.filter(Boolean))]
}

/** Exact lookup with a couple of cheap fallbacks (trailing possessive). */
export function queryEntry(word: string): Entry | undefined {
  const backendHandle = backend()
  if (!backendHandle) return undefined
  for (const candidate of candidates(word)) {
    const row = backendHandle.statement.get(candidate)
    if (row) return row as Entry
  }
  return undefined
}

function lines(text: string | null | undefined): string[] {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const POS_NAMES: Record<string, string> = {
  n: "n.",
  v: "v.",
  s: "adj.",
  a: "adj.",
  j: "adj.",
  r: "adv.",
  m: "num.",
  u: "adj.",
}

/** ECDICT stores senses comma-separated and one part of speech per line. */
export function normalizeChinese(text: string | null | undefined): string {
  return lines(text)
    .map((line) => line.replace(/,\s*/g, "，"))
    .join("；")
}

/** ECDICT's English column is WordNet, where `s being…` means `adj. being…`. */
export function normalizeEnglish(text: string | null | undefined): string {
  return lines(text)
    .map((line) => {
      const match = /^([a-z])\.?\s+(.+)$/.exec(line)
      if (!match) return line
      const name = POS_NAMES[match[1]]
      return name ? `${name} ${match[2]}` : line
    })
    .join("；")
}

/** ECDICT spells stress with ASCII `'` and `,`; IPA uses `ˈ` and `ˌ`. */
export function normalizePhonetic(text: string | null | undefined): string {
  return String(text ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/'/g, "ˈ")
    .replace(/,/g, "ˌ")
    .trim()
}

const EXCHANGE_LABELS: Record<string, string> = {
  p: "过去式",
  d: "过去分词",
  i: "现在分词",
  "3": "三单",
  r: "比较级",
  t: "最高级",
  s: "复数",
  "0": "原形",
}

/** `d:bettered/s:betters/0:good` → `过去分词 bettered · 复数 betters · 原形 good`. */
export function formatExchange(exchange: string | null | undefined): string | undefined {
  if (!exchange) return undefined
  const grouped = new Map<string, string[]>()
  for (const part of exchange.split("/")) {
    const [code, value] = part.split(":")
    const label = EXCHANGE_LABELS[code]
    if (!label || !value) continue
    const labels = grouped.get(value) ?? []
    if (!labels.includes(label)) labels.push(label)
    grouped.set(value, labels)
  }
  const out = [...grouped].map(([value, labels]) => `${labels.join("/")} ${value}`)
  return out.length > 0 ? out.join(" · ") : undefined
}

/** Word card built from a local entry — no network involved. */
export function buildLocalCard(entry: Entry, asked?: string): Card {
  const cardLines: string[] = []
  const chinese = normalizeChinese(entry.translation)
  if (chinese) cardLines.push(`中文  ${shorten(chinese)}`)
  const english = normalizeEnglish(entry.definition)
  if (english) cardLines.push(`EN    ${shorten(english)}`)
  const exchange = formatExchange(entry.exchange)
  if (exchange) cardLines.push(`形    ${shorten(exchange, 150)}`)
  if (cardLines.length === 0) cardLines.push("中文  （这个条目没有释义）")

  const phonetic = normalizePhonetic(entry.phonetic)
  const askedClean = asked?.trim() ?? ""
  const label =
    askedClean && askedClean.toLowerCase() !== entry.word.toLowerCase()
      ? `${askedClean} → ${entry.word}`
      : entry.word
  const title = `dict  ${label}${phonetic ? `  /${phonetic}/` : ""}  ·本地`
  return { kind: "word", title, lines: cardLines }
}

/**
 * Words too common to be worth glossing in a fallback line: a learner already
 * knows them, and they would crowd out the content words.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "done", "to", "of", "in", "on", "at", "by", "for",
  "and", "or", "but", "if", "so", "as", "than", "then", "that", "this",
  "these", "those", "it", "its", "there", "here", "not", "no", "yes",
  "i", "you", "we", "they", "he", "she", "my", "your", "our", "their", "his",
  "her", "can", "could", "will", "would", "shall", "should", "may", "might",
  "must", "have", "has", "had", "with", "from", "into", "over", "up", "out",
])

/** `n`, `v`, `j`, `r` … — the codes ECDICT uses in its `pos` column. */
const TRANSLATION_CODES: Record<string, string> = {
  n: "n",
  v: "v",
  vt: "v",
  vi: "v",
  vg: "v",
  a: "j",
  adj: "j",
  j: "j",
  ad: "r",
  adv: "r",
  r: "r",
}

/** `v:2/n:98` → `n`: the part of speech the word is used as most often. */
export function dominantCode(pos: string | null | undefined): string | undefined {
  let best: { code: string; weight: number } | undefined
  for (const part of String(pos ?? "").split("/")) {
    const [code, weight] = part.split(":")
    const value = Number(weight)
    if (!code || Number.isNaN(value)) continue
    if (!best || value > best.weight) best = { code, weight: value }
  }
  return best?.code
}

function linePrefix(line: string): string {
  return (/^([A-Za-z]+)\.?\s/.exec(line)?.[1] ?? "").toLowerCase()
}

/**
 * One short Chinese sense, chosen to match the word's most common part of
 * speech. ECDICT lists `stale` with `n. 尿` first, which is a real sense but a
 * useless gloss for a sentence, so the `pos` column decides which line to read.
 */
export function dominantSense(entry: Entry | undefined): string | undefined {
  if (!entry?.translation) return undefined
  const groups = lines(entry.translation)
  const wanted = dominantCode(entry.pos)
  const matching = wanted
    ? groups.filter((line) => TRANSLATION_CODES[linePrefix(line)] === wanted)
    : []
  for (const group of [...matching, ...groups]) {
    const cleaned = group
      .replace(/^[A-Za-z]+\.\s*/, "")
      .replace(/\[[^\]]+\]\s*/g, "")
      .trim()
    const first = cleaned.split(/[，,]/)[0]?.trim()
    if (!first) continue
    return first.length > 10 ? first.slice(0, 10) : first
  }
  return undefined
}

/**
 * Word-by-word Chinese gloss used when the translation API is unreachable.
 * Crude on purpose — it is a fallback, and the card says so.
 */
export function glossSentence(
  text: string,
  lookup: (word: string) => Entry | undefined = queryEntry,
): Card | undefined {
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
  const seen = new Set<string>()
  const pairs: string[] = []
  for (const word of words) {
    const key = word.toLowerCase()
    if (seen.has(key) || STOP_WORDS.has(key) || key.length < 2) continue
    seen.add(key)
    const meaning = dominantSense(lookup(key))
    if (meaning) pairs.push(`${word}=${meaning}`)
    if (pairs.length >= 12) break
  }
  if (pairs.length === 0) return undefined
  return {
    kind: "sentence",
    title: "zh  离线逐词对照（在线翻译不可用）",
    lines: [`原文  ${shorten(text, 160)}`, `逐词  ${shorten(pairs.join("  ·  "), 220)}`],
  }
}
