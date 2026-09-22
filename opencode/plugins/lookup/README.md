# lookup

An OpenCode V2 terminal plugin that shows a **word card** or a **Chinese
translation above the input box**.

Nothing is sent to the model and nothing is added to the session, so a lookup
costs **no tokens** and never grows the chat context.

## Usage

| Trigger | What it does |
| --- | --- |
| `/dict ubiquitous` | Word card: 音标 · 中文意思 · English definition · 词形变化 — **offline** |
| `/d stale` | Same, short alias |
| `/zh <sentence>` | Chinese translation of a sentence or paragraph |
| `ctrl+p` → `Look up a word` | Same as `/dict`, prompts for the word |
| `ctrl+p` → `Translate a sentence` | Same as `/zh`, prompts for the text |
| `alt+x` · **`✕ 关闭` in the card** · `ctrl+p` → `Lookup: close the card` | Remove the card |

Run these **inside a session**; the card lives in `session.composer.top`. Outside
a session (the home screen) `/dict` falls back to a dialog, and a slash command
typed before the plugin has loaded is submitted to the model as ordinary text, so
give the TUI a moment after opening it.

Example card:

```text
dict  ubiquitous  /juːˈbikwitəs/  ·本地
中文  a. 无所不在的，到处存在的，普遍存在的
EN    adj. being present everywhere at once
```

The card has a clickable **`✕ 关闭`** button at the right of its title row; a mouse
click closes it, no keyboard needed.

### Long text is wrapped, not truncated

```text
zh  中文翻译
中文  这会消耗你的TokenHub余额，而非OpenCode会话令牌——且不会影响聊天上下文。大致来
      说，每100万输入需要0.04美元，每100万输出需要0.18美元，因此一句话仅需几分之一
      美分。
```

- Latin breaks at spaces, CJK between characters, an over-long word is split
  rather than dropped, and continuation lines line up under the body.
- A line may end two columns wider than the pane so that closing Chinese
  punctuation (。，、；) never starts a line.
- The card uses at most **half the pane height** (capped at 30 lines) so the
  composer stays visible. If the translation is taller, the `原文` echo is dropped
  first, then the last line reads `… 已省略约 N 字`.
- A source longer than 200 characters is not echoed at all — you just pasted it.

## Where the data comes from

**Word cards are offline.** `local.ts` opens a local SQLite snapshot of
[ECDICT](https://github.com/skywind3000/ECDICT) (MIT, 3.4M entries) read-only and
queries it by `word`. That means no API key, no rate limit, no network, and no
dependency on Youdao being up — which is what broke the earlier version with a
`接口错误码 102`.

The snapshot lives in `~/.local/share/lookup/dict.db` (~325 MB, built from an
851 MB source by keeping only the columns a card needs). Override the path with
`OPENCODE_LOOKUP_DB`. If the file is missing, `/dict` falls back to the Youdao
dictionary endpoint.

**Sentences need a network provider.** Three are tried in order, then the offline
gloss:

| Order | Provider | Limit | Notes |
| --- | --- | --- | --- |
| 1 | **Hy-MT2** (`hy-mt2-lite` on Tencent Cloud TokenHub) | your account's quota | an OpenAI-compatible chat endpoint; used only when a key is configured |
| 2 | `aidemo.youdao.com/trans` | ~6 requests per ~30 s, then `errorCode 411`; recovers in ~30 s | free, key-less, no length cap |
| 3 | `api.mymemory.translated.net` | no small burst limit; **500 characters per request** | free, key-less; split into 480-character pieces |
| 4 | offline gloss | none | word-by-word, says so in the title |

Measured on this machine: a burst of 8 Youdao calls gives `0 0 0 0 0 0 411 411`,
and a steady 4 s spacing still hits `411` on the 6th call, so the window is about
five or six calls per half minute. Custom `Referer`/`Origin` headers do not help.

Each `/zh` request translates 1000 characters at a time, so a short sentence is a
single call.

### The translation key

`hy-mt2-lite` is Tencent's 1.8B translation model, served over an
OpenAI-compatible endpoint. The plugin reads the key from, in order:

1. `OPENCODE_LOOKUP_KEY`
2. `~/.config/opencode/lookup.key` (kept at mode `600`)

The model name defaults to `hy-mt2-lite` and can be changed with
`OPENCODE_LOOKUP_MODEL` (`hy-mt2-plus` and `hy-mt2-pro` are also on the account).

The request uses the prompt shape Tencent documents, and the same key is used to
answer a `/dict` word that the offline snapshot does not contain.

If every provider fails, `/zh` degrades to a word-by-word gloss built from the
local snapshot and says so in the card title:

```text
zh  离线逐词对照（在线翻译不可用）
原文  The cache was stale
逐词  cache=隐藏所  ·  stale=不新鲜的
```

Google Translate is unreachable from this machine; TokenHub, Youdao and MyMemory
are reachable.

## Rebuilding the dictionary

```sh
cd ~/.config/opencode/plugins/lookup
bun build-db.ts                 # downloads ECDICT through gh-proxy.com, then rebuilds
bun build-db.ts /tmp/stardict.db  # rebuild from a file you already have
```

`github.com` is not directly reachable here, so the script downloads release
assets through `gh-proxy.com` (measured at ~6–40 MB/s). A cached copy of the
source is kept in `/tmp/opencode/ecdict-build/`, so later rebuilds skip the
download.

## Configuration

Registered CLI-only in `~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/lookup",
      "options": { "width": 100 }
    }
  ]
}
```

| Option | Default | Description |
| --- | --- | --- |
| `width` | measured after layout | Maximum card width in terminal columns. The plugin measures its own container, so only set this to force a narrower card. |
| `OPENCODE_LOOKUP_DB` (env) | `~/.local/share/lookup/dict.db` | Path to the SQLite snapshot. |
| `OPENCODE_LOOKUP_KEY` (env) | `~/.config/opencode/lookup.key` | API key for the Hy-MT2 translation model. |
| `OPENCODE_LOOKUP_MODEL` (env) | `hy-mt2-lite` | Which Hy-MT2 model to call. |

## Why not `!dict`?

A `!` shell command prints into the session, and that output is stored as a shell
message — measured at roughly 6,100 input tokens for a 4,000-line output, re-sent
on every later request. The card here is a UI slot, so it is never part of the
model context. Verified the same way: on a scratch session the counters stayed at
`input=7169 output=141` across a `/dict` and a `/zh`.

## Layout

```text
~/.config/opencode/plugins/lookup/
├── tui.tsx          # commands + the composer.top card
├── card.ts          # card building, formatting, the Youdao sentence call
├── local.ts         # offline ECDICT lookup + card building
├── card.test.ts     # `bun test`
├── build-db.ts      # rebuild the offline snapshot
├── bun-sqlite.d.ts  # tiny ambient type for `bun:sqlite`
├── index.ts         # no-op server entry, no imports
├── package.json
├── tsconfig.json
└── README.md
```

## Development

```sh
cd ~/.config/opencode/plugins/lookup
bun test                          # 54 tests, no network needed
```

Typecheck against the real plugin types (the plugin directory has no
`node_modules`):

```sh
cd /tmp/opencode/check            # deps: @opencode/plugin, @opentui/solid, typescript, bun-types
cp ~/.config/opencode/plugins/lookup/{card.ts,local.ts,card.test.ts,bun-sqlite.d.ts} src/
./node_modules/.bin/tsc -p tsconfig.json
```

Restart the TUI after editing; CLI plugins are loaded at startup.
