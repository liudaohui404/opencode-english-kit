import { describe, expect, test } from "bun:test"
import {
  apiKey,
  modelName,
  translationPrompt,
  buildSentenceCard,
  buildWordCard,
  displayWidth,
  fit,
  layoutCard,
  shorten,
  splitChunks,
  stripCommand,
  stripTags,
  wrap,
  wrapCardLine,
  type Card,
} from "./card.ts"
import {
  buildLocalCard,
  candidates,
  dominantCode,
  dominantSense,
  formatExchange,
  glossSentence,
  normalizeChinese,
  normalizeEnglish,
  normalizePhonetic,
  offlineReady,
  queryEntry,
  type Entry,
} from "./local.ts"

// Shape of a real dict.youdao.com/jsonapi response, trimmed down.
const wordFixture = {
  ec: {
    word: [
      {
        usphone: "juːˈbɪkwɪtəs",
        ukphone: "juːˈbɪkwɪtəs",
        trs: [{ tr: [{ l: { i: ["adj. 普遍存在的，无所不在的"] } }] }],
      },
    ],
  },
  ee: {
    word: {
      trs: [
        { pos: "adj.", tr: [{ l: { i: "being present everywhere at once" } }] },
        { pos: "v.", tr: [{ l: { i: "to exist everywhere" } }] },
      ],
    },
  },
  blng_sents_part: {
    "sentence-pair": [
      {
        "sentence-eng": "The <b>ubiquitous</b> nature of E-mail makes it simple.",
        "sentence-translation": "电子邮件非常普遍，这让它变得简单。",
      },
    ],
  },
}

describe("stripCommand", () => {
  test("removes a leading slash command", () => {
    expect(stripCommand("/dict stale")).toBe("stale")
    expect(stripCommand("/zh   hello world")).toBe("hello world")
    expect(stripCommand("  /d stale")).toBe("stale")
  })

  test("leaves plain text untouched", () => {
    expect(stripCommand("stale")).toBe("stale")
  })
})

describe("stripTags", () => {
  test("removes markup and trims", () => {
    expect(stripTags("The <b>ubiquitous</b> nature")).toBe("The ubiquitous nature")
    expect(stripTags(undefined)).toBe("")
  })
})

describe("displayWidth / fit", () => {
  test("counts CJK as two columns", () => {
    expect(displayWidth("abc")).toBe(3)
    expect(displayWidth("中文")).toBe(4)
    expect(displayWidth("a中")).toBe(3)
  })

  test("leaves short strings intact", () => {
    expect(fit("hello", 10)).toBe("hello")
  })

  test("truncates by columns with an ellipsis", () => {
    expect(fit("中文中文", 5)).toBe("中文…")
    expect(fit("abcdefgh", 5)).toBe("abcd…")
  })
})

describe("shorten", () => {
  test("keeps short text", () => {
    expect(shorten("短的")).toBe("短的")
  })

  test("cuts at a sense boundary", () => {
    const long = "adj. 甲；乙；丙；丁；戊"
    const result = shorten(long, 10)
    expect(result.endsWith("…")).toBe(true)
    expect(result.length).toBeLessThanOrEqual(11)
  })
})

describe("splitChunks", () => {
  test("keeps small text whole", () => {
    expect(splitChunks("hello world", 100)).toEqual(["hello world"])
    expect(splitChunks("   ", 100)).toEqual([])
  })

  test("never exceeds the limit", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(50)
    for (const chunk of splitChunks(text, 120)) {
      expect(chunk.length).toBeLessThanOrEqual(120)
    }
  })
})

describe("buildWordCard", () => {
  test("builds a labelled card from a dictionary response", () => {
    const card = buildWordCard("ubiquitous", wordFixture)
    expect(card).toBeDefined()
    expect(card?.title).toBe("dict  ubiquitous  /juːˈbɪkwɪtəs/")
    expect(card?.lines[0]).toContain("中文")
    expect(card?.lines[0]).toContain("普遍存在的")
    expect(card?.lines[1]).toContain("EN")
    expect(card?.lines[1]).toContain("being present everywhere at once")
    // prefer the definition whose part of speech matches the first Chinese sense
    expect(card?.lines[1]).toContain("adj.")
    expect(card?.lines[2]).toContain("例")
    expect(card?.lines[2]).not.toContain("<b>")
  })

  test("returns undefined when the dictionary has nothing", () => {
    expect(buildWordCard("zzz", { ec: {}, ee: {} })).toBeUndefined()
    expect(buildWordCard("zzz", {})).toBeUndefined()
  })
})

describe("buildSentenceCard", () => {
  test("shows the source and the translation", () => {
    const card = buildSentenceCard("The build failed.", "构建失败了。")
    expect(card.title).toBe("zh  中文翻译")
    expect(card.lines[0]).toBe("原文  The build failed.")
    expect(card.lines[1]).toBe("中文  构建失败了。")
  })

  test("keeps multi-line translations aligned", () => {
    const card = buildSentenceCard("a", "第一段\n第二段")
    expect(card.lines[1]).toBe("中文  第一段")
    expect(card.lines[2]).toBe("      第二段")
  })

  test("handles an empty translation", () => {
    const card = buildSentenceCard("a", "   ")
    expect(card.lines[1]).toContain("没有返回结果")
  })
})

// A real ECDICT row, trimmed to the columns the card uses.
const localFixture: Entry = {
  word: "ubiquitous",
  phonetic: "juː'bikwitəs",
  translation: "a. 无所不在的, 到处存在的, 普遍存在的",
  definition: "s being present everywhere at once",
  pos: "j:100",
  collins: 1,
  oxford: null,
  tag: "gre",
  bnc: 10091,
  frq: 8148,
  exchange: "",
}

describe("normalizeChinese", () => {
  test("joins parts of speech and uses Chinese commas", () => {
    expect(normalizeChinese("n. 赛跑, 流出\na. 流动的")).toBe("n. 赛跑，流出；a. 流动的")
  })

  test("tolerates empty input", () => {
    expect(normalizeChinese(null)).toBe("")
  })
})

describe("normalizeEnglish", () => {
  test("expands the WordNet part-of-speech code", () => {
    expect(normalizeEnglish("s being present everywhere at once")).toBe(
      "adj. being present everywhere at once",
    )
    expect(normalizeEnglish("n a state of being")).toBe("n. a state of being")
  })

  test("leaves unmarked lines alone", () => {
    expect(normalizeEnglish("plain text")).toBe("plain text")
  })

  test("also handles the dotted code ECDICT sometimes keeps", () => {
    expect(normalizeEnglish("s. unchanged in value")).toBe("adj. unchanged in value")
  })
})

describe("normalizePhonetic", () => {
  test("rewrites ASCII stress marks as IPA", () => {
    expect(normalizePhonetic("juː'bikwitəs")).toBe("juːˈbikwitəs")
    expect(normalizePhonetic("'aidəm,pəutənt")).toBe("ˈaidəmˌpəutənt")
  })

  test("drops surrounding slashes", () => {
    expect(normalizePhonetic("/stale/")).toBe("stale")
  })
})

describe("formatExchange", () => {
  test("groups labels that share a value", () => {
    expect(formatExchange("d:bettered/p:bettered/3:betters/0:good")).toBe(
      "过去分词/过去式 bettered · 三单 betters · 原形 good",
    )
  })

  test("returns undefined for empty input", () => {
    expect(formatExchange("")).toBeUndefined()
    expect(formatExchange(null)).toBeUndefined()
  })
})

describe("candidates", () => {
  test("strips quotes and adds a possessive fallback", () => {
    expect(candidates("“stale”")).toEqual(["stale"])
    expect(candidates("measure's")).toEqual(["measure's", "measure"])
    expect(candidates("  ")).toEqual([])
  })
})

describe("buildLocalCard", () => {
  test("labels the local snapshot and keeps the phonetic", () => {
    const card = buildLocalCard(localFixture, "ubiquitous")
    expect(card.title).toBe("dict  ubiquitous  /juːˈbikwitəs/  ·本地")
    expect(card.lines[0]).toBe("中文  a. 无所不在的，到处存在的，普遍存在的")
    expect(card.lines[1]).toBe("EN    adj. being present everywhere at once")
  })

  test("shows the base word when an inflected form was asked for", () => {
    const card = buildLocalCard({ ...localFixture, word: "measure" }, "measures")
    expect(card.title).toContain("measures → measure")
  })

  test("still renders when a row has no Chinese gloss", () => {
    const card = buildLocalCard({ ...localFixture, translation: "", definition: "" })
    expect(card.lines[0]).toContain("没有释义")
  })
})

describe("glossSentence", () => {
  const lookup = (word: string): Entry | undefined =>
    ({ stale: { ...localFixture, word, translation: "a. 陈旧的" },
       cache: { ...localFixture, word, translation: "n. 缓存, 高速缓冲存储器" } })[word]

  test("glosses content words and skips stop words", () => {
    const card = glossSentence("The cache may be stale", lookup)
    expect(card?.title).toContain("离线")
    expect(card?.lines[1]).toContain("cache=缓存")
    expect(card?.lines[1]).toContain("stale=陈旧的")
    expect(card?.lines[1]).not.toContain("the=")
  })

  test("returns undefined when nothing is known", () => {
    expect(glossSentence("zzz qqq", () => undefined)).toBeUndefined()
  })
})

// Runs against the real snapshot when it is installed; skipped otherwise.
describe("local database", () => {
  test.skipIf(!offlineReady())("finds a real entry", () => {
    const entry = queryEntry("ubiquitous")
    expect(entry?.word).toBe("ubiquitous")
    expect(entry?.translation).toContain("无所不在")
    expect(buildLocalCard(entry!).lines[0]).toContain("中文")
  })

  test.skipIf(!offlineReady())("finds inflected forms", () => {
    expect(queryEntry("ran")?.translation).toContain("过去式")
    expect(queryEntry("children")?.translation).toContain("孩子")
  })

  test.skipIf(!offlineReady())("returns undefined for an unknown word", () => {
    expect(queryEntry("zzzqqxx")).toBeUndefined()
  })
})

describe("dominantSense", () => {
  const base = localFixture
  test("picks the line for the most common part of speech", () => {
    // `stale` really is listed as `n. 尿` first; the adjective line is wanted.
    const entry: Entry = {
      ...base,
      word: "stale",
      pos: "j:100",
      translation: "n. 尿\na. 不新鲜的, 陈腐的, 疲惫的\nvi. 变陈旧, 走味, 撒尿",
    }
    expect(dominantSense(entry)).toBe("不新鲜的")
  })

  test("falls back to the first line when pos is missing", () => {
    const entry: Entry = { ...base, pos: null, translation: "n. 缓存, 贮藏物" }
    expect(dominantSense(entry)).toBe("缓存")
  })

  test("strips domain markers like [计]", () => {
    const entry: Entry = { ...base, pos: "n:100", translation: "[计] 高速缓冲存储器, 高速缓冲" }
    expect(dominantSense(entry)).toBe("高速缓冲存储器")
  })

  test("handles a missing entry", () => {
    expect(dominantSense(undefined)).toBeUndefined()
  })

  test("reads the weights out of the pos column", () => {
    expect(dominantCode("v:2/n:98")).toBe("n")
    expect(dominantCode("n:2/v:98")).toBe("v")
    expect(dominantCode(null)).toBeUndefined()
  })
})

describe("translation provider config", () => {
  test("the prompt names the target language and asks for the result only", () => {
    const prompt = translationPrompt("hello world")
    expect(prompt).toContain("Chinese")
    expect(prompt).toContain("hello world")
    expect(prompt.toLowerCase()).toContain("without any additional explanation")
  })

  test("the model can be overridden by environment", () => {
    const before = process.env.OPENCODE_LOOKUP_MODEL
    process.env.OPENCODE_LOOKUP_MODEL = "hy-mt2-pro"
    expect(modelName()).toBe("hy-mt2-pro")
    delete process.env.OPENCODE_LOOKUP_MODEL
    expect(modelName()).toBe("hy-mt2-lite")
    if (before !== undefined) process.env.OPENCODE_LOOKUP_MODEL = before
  })

  test("an environment key wins over the key file", () => {
    const before = process.env.OPENCODE_LOOKUP_KEY
    process.env.OPENCODE_LOOKUP_KEY = "sk-from-env"
    expect(apiKey()).toBe("sk-from-env")
    if (before === undefined) delete process.env.OPENCODE_LOOKUP_KEY
    else process.env.OPENCODE_LOOKUP_KEY = before
  })
})

describe("wrap", () => {
  test("breaks CJK between characters", () => {
    expect(wrap("中文中文", 4)).toEqual(["中文", "中文"])
  })

  test("breaks Latin at spaces", () => {
    expect(wrap("the quick brown fox", 10)).toEqual(["the quick", "brown fox"])
  })

  test("never exceeds the width", () => {
    for (const width of [8, 16, 40]) {
      for (const line of wrap("a very long sentence with words and 中文字符 mixed in", width)) {
        // hanging punctuation may exceed the width by two columns
        expect(displayWidth(line)).toBeLessThanOrEqual(width + 2)
      }
    }
  })

  test("hard-splits a word longer than the line", () => {
    expect(wrap("supercalifragilistic", 8)).toEqual(["supercal", "ifragili", "stic"])
  })

  test("keeps an empty string empty", () => {
    expect(wrap("", 10)).toEqual([])
  })
})

describe("wrapCardLine", () => {
  test("aligns continuation lines under the body, not the label", () => {
    const out = wrapCardLine("中文  这是一个很长的中文句子用来测试换行", 14)
    expect(out[0].startsWith("中文  ")).toBe(true)
    for (const line of out.slice(1)) expect(line.startsWith("      ")).toBe(true)
    for (const line of out) expect(displayWidth(line)).toBeLessThanOrEqual(14)
  })
})

describe("layoutCard", () => {
  test("keeps everything when it fits", () => {
    const card = buildSentenceCard("Hello.", "你好。")
    const out = layoutCard(card, 40, 10)
    expect(out).toEqual(["原文  Hello.", "中文  你好。"])
  })

  test("wraps instead of truncating a long translation", () => {
    const long = "缓存已失效因此构建失败".repeat(4)
    const card = buildSentenceCard("x", long)
    const out = layoutCard(card, 20, 10)
    expect(out.length).toBeGreaterThan(1)
    // indentation is inserted between wrapped pieces, so compare without spaces
    expect(out.join("").replace(/\s+/g, "")).toContain(long.slice(0, 20))
    expect(out.join("")).not.toContain("…")
  })

  test("drops the source echo before cutting the translation", () => {
    const card: Card = { kind: "sentence", title: "zh", lines: ["原文  " + "a".repeat(60), "中文  " + "中".repeat(60)] }
    const out = layoutCard(card, 40, 4)
    expect(out.some((line) => line.startsWith("原文"))).toBe(false)
    expect(out.some((line) => line.startsWith("中文"))).toBe(true)
  })

  test("summarises what it had to hide, and never exceeds the budget", () => {
    const card: Card = { kind: "sentence", title: "zh", lines: ["中文  " + "字".repeat(400)] }
    const out = layoutCard(card, 20, 5)
    expect(out.length).toBeLessThanOrEqual(5)
    expect(out.at(-1)).toContain("已省略")
  })

  test("hides nothing when the card is short", () => {
    const out = layoutCard({ kind: "word", title: "t", lines: ["中文  短的"] }, 40, 5)
    expect(out.at(-1)).not.toContain("已省略")
  })
})

describe("wrapCardLine with an existing indent", () => {
  test("keeps the indent on multi-chunk translation lines", () => {
    const out = wrapCardLine("      他们会听到这件事。无效性消息可能会延迟或丢失", 22)
    expect(out[0].startsWith("      ")).toBe(true)
    // hanging closing punctuation may add up to two columns
    for (const line of out) expect(displayWidth(line)).toBeLessThanOrEqual(24)
  })
})

describe("wrap punctuation", () => {
  const closing = new Set(["。", "，", "、", "；", "：", "！", "？", "）", "】", "》", "」", "』", "”", "’", "…", "—", "～"])

  test("never starts a line with a closing mark", () => {
    const out = wrap("缓存已失效。因此构建失败，这是常见问题；确实如此。", 12)
    expect(out.length).toBeGreaterThan(1)
    for (const line of out) expect(closing.has(line[0] ?? "")).toBe(false)
  })
})
