/**
 * Lookup backend and card formatting.
 *
 * Word cards come from the local ECDICT snapshot (see `local.ts`): no network,
 * no model call, so a lookup costs no tokens and never joins the session. The
 * network is only used for a sentence translation, which tries the keyed Hy-MT2
 * model, then two free key-less endpoints, then an offline gloss. Everything
 * here is pure or a single HTTP call, so it is easy to unit-test.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { buildLocalCard, glossSentence, offlineReady, queryEntry } from "./local"

export interface Card {
  readonly kind: "word" | "sentence"
  /** Short label line, e.g. `dict  ubiquitous  /juːˈbɪkwɪtəs/`. */
  readonly title: string
  /** Body lines, already labelled (`中文`, `EN`, `例`, …). */
  readonly lines: readonly string[]
}

const UA = "Mozilla/5.0 (X11; Linux x86_64)"
const DICT_URL = "https://dict.youdao.com/jsonapi?q="
const TRANS_URL = "https://aidemo.youdao.com/trans"
const MYMEMORY_URL = "https://api.mymemory.translated.net/get"
/** Tencent Cloud TokenHub — OpenAI-compatible, serves the Hy-MT2 translation models. */
const TOKENHUB_URL = "https://tokenhub.tencentmaas.com/v1/chat/completions"
const DEFAULT_MODEL = "hy-mt2-lite"
const KEY_PATH = join(homedir(), ".config", "opencode", "lookup.key")
const MAX_CHUNK = 1000
/** MyMemory rejects anything over 500 characters, so the fallback splits again. */
const MAX_CHUNK_MYMEMORY = 480

/**
 * API key for the translation model, from the environment first so it can be
 * injected without a file, then from a git-ignored file kept at mode 600.
 */
export function apiKey(): string | undefined {
  const fromEnv = process.env.OPENCODE_LOOKUP_KEY?.trim()
  if (fromEnv) return fromEnv
  try {
    if (!existsSync(KEY_PATH)) return undefined
    return readFileSync(KEY_PATH, "utf8").trim() || undefined
  } catch {
    return undefined
  }
}

export function modelName(): string {
  return process.env.OPENCODE_LOOKUP_MODEL?.trim() || DEFAULT_MODEL
}

/** The prompt shape Hy-MT2 documents: target language in words, result only. */
export function translationPrompt(text: string): string {
  return `Translate the following text into Chinese. Note: Output only the translated result without any additional explanation: ${text}`
}

const KNOWN_POS = [
  "adj.", "adv.", "n.", "v.", "vt.", "vi.", "prep.", "conj.", "pron.",
  "num.", "int.", "art.", "aux.", "abbr.", "det.", "modal.", "prefix.", "suffix.",
]

/** Drops the leading `/dict` token that `arguments: true` may include. */
export function stripCommand(input: string): string {
  return input.replace(/^\s*\/[A-Za-z_-]+\s*/, "").trim()
}

export function stripTags(text: unknown): string {
  return String(text ?? "").replace(/<[^>]+>/g, "").trim()
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

/** Terminal columns a string occupies (CJK counts as two). */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1
  return width
}

/** Truncates to `width` columns, adding an ellipsis when it cuts. */
export function fit(text: string, width: number): string {
  if (width <= 1 || displayWidth(text) <= width) return text
  let out = ""
  let used = 0
  for (const char of text) {
    const charWidth = isWide(char.codePointAt(0) ?? 0) ? 2 : 1
    if (used + charWidth > width - 1) break
    out += char
    used += charWidth
  }
  return out + "…"
}

/** Keeps a definition short: cut at a sense boundary rather than mid-phrase. */
export function shorten(text: string, limit = 110): string {
  const value = text.trim().replace(/\s+/g, " ")
  if (value.length <= limit) return value
  const cut = value.lastIndexOf("；", limit)
  const base = cut > 30 ? value.slice(0, cut) : value.slice(0, limit)
  return base.replace(/[；。，,]$/, "") + "…"
}

/** Splits long text at sentence boundaries for the per-request size limit. */
export function splitChunks(text: string, max = MAX_CHUNK): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed ? [trimmed] : []
  const breaks = ["\n", "。", ". ", "! ", "? ", "；", "; ", "，", ", ", " "]
  const parts: string[] = []
  let rest = trimmed
  while (rest.length > max) {
    let cut = -1
    for (const mark of breaks) {
      const index = rest.lastIndexOf(mark, max)
      if (index > cut) cut = index + mark.length
    }
    if (cut <= 0) cut = max
    const part = rest.slice(0, cut).trim()
    if (part) parts.push(part)
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

/** Splits text into wrap units: a word, a single CJK char, or a space run. */
function wrapTokens(text: string): string[] {
  const out: string[] = []
  let buffer = ""
  const flush = () => {
    if (buffer) {
      out.push(buffer)
      buffer = ""
    }
  }
  for (const char of text) {
    if (/\s/.test(char)) {
      flush()
      out.push(" ")
      continue
    }
    if (isWide(char.codePointAt(0) ?? 0)) {
      flush()
      out.push(char)
      continue
    }
    buffer += char
  }
  flush()
  return out
}

/** Hard-splits a token that is wider than the whole line. */
function breakToken(token: string, width: number): string[] {
  const pieces: string[] = []
  let piece = ""
  let used = 0
  for (const char of token) {
    const charWidth = isWide(char.codePointAt(0) ?? 0) ? 2 : 1
    if (used + charWidth > width && piece) {
      pieces.push(piece)
      piece = ""
      used = 0
    }
    piece += char
    used += charWidth
  }
  if (piece) pieces.push(piece)
  return pieces
}

/** Chinese punctuation that must not begin a line (avoid 行首标点). */
const NO_LINE_START = new Set([
  "。", "，", "、", "；", "：", "！", "？", "）", "】", "》", "」", "』", "”", "’", "…", "—", "～",
])

/** Pulls closing punctuation back onto the previous line, at most two marks. */
function hangClosingMarks(lines: string[]): string[] {
  for (let index = 1; index < lines.length; index++) {
    let moved = ""
    while (moved.length < 2 && lines[index].length > 0 && NO_LINE_START.has(lines[index][0])) {
      moved += lines[index][0]
      lines[index] = lines[index].slice(1)
    }
    if (moved) lines[index - 1] += moved
  }
  return lines.filter((line) => line.trim().length > 0)
}

/**
 * Greedy wrap to `width` columns. Latin text breaks at spaces, CJK breaks
 * between characters, and an over-long word is split rather than dropped.
 * A line may end up to two columns wider than `width` so that closing Chinese
 * punctuation is never pushed to the start of the next line.
 */
export function wrap(text: string, width: number): string[] {
  if (width < 2) return text ? [text] : []
  const lines: string[] = []
  let line = ""
  let used = 0

  for (const token of wrapTokens(text)) {
    if (token === " ") {
      if (used > 0 && used + 1 <= width) {
        line += " "
        used += 1
      }
      continue
    }
    const tokenWidth = displayWidth(token)
    if (used + tokenWidth <= width) {
      line += token
      used += tokenWidth
      continue
    }
    if (line.trim()) lines.push(line.replace(/\s+$/, ""))
    if (tokenWidth <= width) {
      line = token
      used = tokenWidth
      continue
    }
    const pieces = breakToken(token, width)
    for (const piece of pieces.slice(0, -1)) lines.push(piece)
    line = pieces.at(-1) ?? ""
    used = displayWidth(line)
  }
  if (line.trim()) lines.push(line.replace(/\s+$/, ""))
  return hangClosingMarks(lines)
}

/**
 * Wraps a card line, keeping the `中文  ` label column free so continuation
 * lines line up under the body instead of under the label.
 */
export function wrapCardLine(line: string, width: number): string[] {
  // A label like `中文  `, or an existing six-space continuation indent.
  const label = /^(\s*[^\s]+\s+|\s+)/.exec(line)?.[1] ?? ""
  const body = line.slice(label.length)
  const indent = displayWidth(label)
  if (!body || width - indent < 8) return wrap(line, width)
  const pieces = wrap(body, width - indent)
  if (pieces.length === 0) return [line.trimEnd()]
  return [`${label}${pieces[0]}`, ...pieces.slice(1).map((piece) => `${" ".repeat(indent)}${piece}`)]
}

/**
 * Full card layout for a given width and line budget.
 *
 * A pasted paragraph can be far taller than the space above the input box, so
 * the source echo is dropped first and the remainder is summarised rather than
 * silently cut mid-sentence.
 */
export function layoutCard(card: Card, width: number, maxLines: number): string[] {
  const wrapped: string[] = []
  for (const line of card.lines) {
    for (const piece of wrapCardLine(line, width)) wrapped.push(piece)
  }
  if (wrapped.length <= maxLines) return wrapped

  const withoutSource = wrapped.filter((line) => !line.startsWith("原文"))
  const pool = withoutSource.length > 0 ? withoutSource : wrapped
  if (pool.length <= maxLines) return pool

  const keep = Math.max(1, maxLines - 1)
  const shown = pool.slice(0, keep)
  const hidden = pool.slice(keep).join("").replace(/\s+/g, "")
  shown.push(`… 已省略约 ${hidden.length} 字`)
  return shown
}

function collectTranslations(groups: unknown): string[] {
  if (!Array.isArray(groups)) return []
  const out: string[] = []
  for (const group of groups) {
    const trs = (group as { tr?: unknown }).tr
    if (!Array.isArray(trs)) continue
    for (const tr of trs) {
      const value = (tr as { l?: { i?: unknown } }).l?.i
      if (typeof value === "string") {
        const text = stripTags(value)
        if (text) out.push(text)
      } else if (Array.isArray(value)) {
        const text = stripTags(value.filter((part): part is string => typeof part === "string").join("；"))
        if (text) out.push(text)
      }
    }
  }
  return out
}

function englishDefinition(english: unknown, wanted: string): string | undefined {
  const trs = (english as { trs?: unknown })?.trs
  if (!Array.isArray(trs)) return undefined
  const usable = trs.filter((group) => {
    const pos = String((group as { pos?: unknown }).pos ?? "")
    return KNOWN_POS.some((known) => pos.startsWith(known))
  })
  const preferred = usable.filter((group) =>
    wanted ? String((group as { pos?: unknown }).pos ?? "").startsWith(wanted) : false,
  )
  const group = (preferred.length > 0 ? preferred : usable)[0] as
    | { pos?: unknown; tr?: unknown }
    | undefined
  if (!group || !Array.isArray(group.tr) || group.tr.length === 0) return undefined
  const value = stripTags((group.tr[0] as { l?: { i?: unknown } }).l?.i)
  if (!value) return undefined
  const pos = String(group.pos ?? "").trim()
  return `${pos} ${shorten(value)}`.trim()
}

function examplePair(root: Record<string, unknown>): [string, string] | undefined {
  const part = root["blng_sents_part"] as { "sentence-pair"?: unknown } | undefined
  const pairs = part?.["sentence-pair"]
  if (!Array.isArray(pairs) || pairs.length === 0) return undefined
  const first = pairs[0] as Record<string, unknown>
  return [stripTags(first["sentence-eng"] ?? first["sentence"]), stripTags(first["sentence-translation"])]
}

/** Builds a word card from a `dict.youdao.com/jsonapi` response. */
export function buildWordCard(word: string, data: unknown): Card | undefined {
  const root = (data ?? {}) as Record<string, unknown>
  const entries = (root["ec"] as { word?: unknown } | undefined)?.word
  const entry = (Array.isArray(entries) ? entries[0] : undefined) as
    | { usphone?: unknown; ukphone?: unknown; trs?: unknown }
    | undefined

  const phone = String(entry?.usphone ?? entry?.ukphone ?? "").trim()
  const meanings = collectTranslations(entry?.trs)
  const wanted = meanings[0]?.match(/^\s*([a-z]+\.)/)?.[1] ?? ""
  const english = (root["ee"] as { word?: unknown } | undefined)?.word

  const lines: string[] = []
  if (meanings.length > 0) lines.push(`中文  ${shorten(meanings.join("；"))}`)
  const definition = englishDefinition(english, wanted)
  if (definition) lines.push(`EN    ${definition}`)
  const example = examplePair(root)
  if (example?.[0]) lines.push(`例    ${shorten(example[0], 160)}`)
  if (example?.[1]) lines.push(`      ${shorten(example[1], 160)}`)
  if (lines.length === 0) return undefined

  return { kind: "word", title: `dict  ${word}${phone ? `  /${phone}/` : ""}`, lines }
}

/** Longest source echo worth showing: any longer and the user just pasted it. */
export const SOURCE_ECHO_LIMIT = 200

/**
 * Builds a sentence card from source text and its translation.
 *
 * Text is not truncated here — `layoutCard` wraps it to the card width, so a
 * pasted paragraph stays readable.
 */
export function buildSentenceCard(source: string, translation: string): Card {
  const body = translation
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const lines: string[] = []
  if (source.trim().length <= SOURCE_ECHO_LIMIT) {
    lines.push(`原文  ${shorten(source, SOURCE_ECHO_LIMIT)}`)
  }
  body.forEach((line, index) => lines.push(`${index === 0 ? "中文  " : "      "}${line}`))
  if (body.length === 0) lines.push("中文  （没有返回结果）")
  return { kind: "sentence", title: "zh  中文翻译", lines }
}

async function httpJson(url: string, body: string | undefined, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
    body,
    signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function translateYoudao(text: string, signal?: AbortSignal): Promise<string> {
  const body = new URLSearchParams({ q: text, from: "auto", to: "zh-CHS" }).toString()
  const data = (await httpJson(TRANS_URL, body, signal)) as { errorCode?: string; translation?: unknown }
  if (data.errorCode && data.errorCode !== "0") throw new Error(`接口错误码 ${data.errorCode}`)
  const out = Array.isArray(data.translation)
    ? data.translation.filter((part): part is string => typeof part === "string").join("")
    : ""
  if (!out.trim()) throw new Error("接口返回空结果")
  return out.trim()
}

async function translateMyMemory(text: string, signal?: AbortSignal): Promise<string> {
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=en%7Czh-CN`
  const data = (await httpJson(url, undefined, signal)) as {
    responseStatus?: unknown
    responseData?: { translatedText?: unknown }
  }
  const out = String(data.responseData?.translatedText ?? "").trim()
  if (Number(data.responseStatus) !== 200 || !out) {
    throw new Error(`MyMemory 接口错误 ${String(data.responseStatus ?? "?")}`)
  }
  return out
}

async function translateTokenHub(text: string, signal?: AbortSignal): Promise<string> {
  const key = apiKey()
  if (!key) throw new Error("没有配置翻译模型 key")
  const response = await fetch(TOKENHUB_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: modelName(),
      messages: [{ role: "user", content: translationPrompt(text) }],
    }),
    signal,
  })
  if (!response.ok) throw new Error(`TokenHub HTTP ${response.status}`)
  const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] }
  const out = String(data.choices?.[0]?.message?.content ?? "").trim()
  if (!out) throw new Error("TokenHub 返回空结果")
  return out
}

/**
 * One translation, best provider first.
 *
 * Order: the Hy-MT2 model (if a key is configured), then the free Youdao
 * endpoint — which **throttles** after a handful of requests in a short window
 * (`errorCode 411`) — then MyMemory, which has a 500-character limit but a much
 * larger quota. Only if all three fail does the caller show the offline gloss.
 */
async function translateOnce(text: string, signal?: AbortSignal): Promise<string> {
  const attempts: (() => Promise<string>)[] = []
  if (apiKey()) attempts.push(() => translateTokenHub(text, signal))
  attempts.push(() => translateYoudao(text, signal))
  attempts.push(async () => {
    const parts: string[] = []
    for (const piece of splitChunks(text, MAX_CHUNK_MYMEMORY)) {
      parts.push(await translateMyMemory(piece, signal))
    }
    return parts.join("")
  })

  let last: unknown
  for (const attempt of attempts) {
    try {
      return await attempt()
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error("所有翻译接口都无法使用")
}

/** Word card. Offline first; the network is only used if no snapshot is installed. */
export async function lookupWord(word: string, signal?: AbortSignal): Promise<Card> {
  if (offlineReady()) {
    const entry = queryEntry(word)
    if (entry) return buildLocalCard(entry, word)
    // A miss in 3.4M entries is usually a name or a typo; the model can still help.
    if (apiKey()) {
      try {
        const translation = await translateOnce(word, signal)
        return { kind: "word", title: `dict  ${word}  ·联网`, lines: [`中文  ${shorten(translation)}`] }
      } catch {
        /* fall through to the not-found card */
      }
    }
    return {
      kind: "word",
      title: `dict  ${word}  ·本地`,
      lines: ["中文  本地词典没有收录这个词"],
    }
  }
  const data = await httpJson(DICT_URL + encodeURIComponent(word), undefined, signal)
  const card = buildWordCard(word, data)
  if (card) return card
  const translation = await translateOnce(word, signal)
  return { kind: "word", title: `dict  ${word}`, lines: [`中文  ${shorten(translation)}`] }
}

/** Sentence card; long text is sent as several requests, with an offline gloss fallback. */
export async function translateSentence(text: string, signal?: AbortSignal): Promise<Card> {
  try {
    const parts: string[] = []
    for (const chunk of splitChunks(text)) parts.push(await translateOnce(chunk, signal))
    return buildSentenceCard(text, parts.join("\n"))
  } catch (error) {
    const fallback = glossSentence(text)
    if (fallback) return fallback
    throw error
  }
}
