/**
 * lookup — show a word card or a Chinese translation above the input box.
 *
 * Nothing is sent to the model and nothing is added to the session, so a lookup
 * costs no tokens and never grows the chat context. The card is rendered in the
 * `session.composer.top` slot, the same way the stock plugin uses the sidebar.
 *
 * Triggers:
 *   /dict ubiquitous      word card (offline ECDICT snapshot, no network)
 *   /zh <sentence>        Chinese translation (free API, offline gloss if it fails)
 *   ctrl+p → Lookup: …    same commands, prompts for the text
 *   alt+x                 close the card
 *
 * Registration is CLI-only, from `cli.json`:
 *
 *   { "plugins": [ { "package": "./plugins/lookup", "options": { "width": 100 } } ] }
 */
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createSignal } from "solid-js"
import {
  displayWidth,
  errorMessage,
  fit,
  layoutCard,
  lookupWord,
  stripCommand,
  translateSentence,
  type Card,
} from "./card"

export default Plugin.define({
  id: "lookup",
  setup(context) {
    const [card, setCard] = createSignal<Card | undefined>(undefined)
    const widthOption = typeof context.options.width === "number" ? context.options.width : undefined
    let busy = false

    /** Inside a session the card is a slot; elsewhere fall back to a dialog. */
    const present = (value: Card) => {
      if (context.ui.router.current().type === "session") {
        setCard(value)
        return
      }
      void context.ui.dialog.alert({ title: value.title, message: value.lines.join("\n") })
    }

    const askFor = async (title: string, placeholder: string): Promise<string | undefined> => {
      const answer = await context.ui.dialog.prompt({ title, placeholder })
      const text = answer?.trim()
      return text ? text : undefined
    }

    const runWord = async (input?: string) => {
      if (busy) return
      const inline = input ? stripCommand(input) : ""
      const word = inline || (await askFor("查词 / look up a word", "例如 ubiquitous"))
      if (!word) return
      busy = true
      try {
        present(await lookupWord(word))
      } catch (error) {
        context.ui.toast.show({ title: "lookup", message: errorMessage(error), variant: "error" })
      } finally {
        busy = false
      }
    }

    const runSentence = async (input?: string) => {
      if (busy) return
      const inline = input ? stripCommand(input) : ""
      const text = inline || (await askFor("翻译 / translate to Chinese", "粘贴英文句子"))
      if (!text) return
      busy = true
      try {
        present(await translateSentence(text))
      } catch (error) {
        context.ui.toast.show({ title: "lookup", message: errorMessage(error), variant: "error" })
      } finally {
        busy = false
      }
    }

    const unregisterCard = context.ui.slot({
      append: "session.composer.top",
      render: () => (
        <Show when={card()}>
          {(value) => (
            <CardView
              context={context}
              card={value()}
              width={widthOption}
              onClose={() => setCard(undefined)}
            />
          )}
        </Show>
      ),
    })

    const unregisterCommands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          priority: 10,
          commands: [
            {
              id: "lookup.word",
              title: "Look up a word",
              description: "Show a word card above the input box — offline dictionary, no tokens",
              group: "Lookup",
              palette: true,
              suggested: true,
              slash: { name: "dict", aliases: ["d"], arguments: true },
              run: (input) => runWord(input),
            },
            {
              id: "lookup.sentence",
              title: "Translate a sentence",
              description: "Show a Chinese translation above the input box — falls back to a local word-by-word gloss",
              group: "Lookup",
              palette: true,
              slash: { name: "zh", arguments: true },
              run: (input) => runSentence(input),
            },
            {
              id: "lookup.clear",
              title: "Lookup: close the card",
              group: "Lookup",
              palette: true,
              bind: "alt+x",
              run: () => setCard(undefined),
            },
          ],
          bindings: ["lookup.clear"],
        }))
        return null
      },
    })

    return () => {
      unregisterCard()
      unregisterCommands()
    }
  },
})

interface CardViewProps {
  readonly context: Plugin.Context
  readonly card: Card
  readonly width?: number
  readonly onClose: () => void
}

/** Screen label for the close affordance, also used to reserve title space. */
const CLOSE_LABEL = "✕ 关闭"

function CardView(props: CardViewProps) {
  const theme = () => props.context.theme
  const [measured, setMeasured] = createSignal(0)
  const [hovering, setHovering] = createSignal(false)
  let box: { width?: number } | null = null

  // The slot's own width is not exposed, so measure the box after layout.
  const measure = () => {
    const value = box?.width
    if (typeof value === "number" && value > 0) {
      const next = Math.floor(value) - 3
      if (Math.abs(next - measured()) >= 2) setMeasured(next)
    }
  }

  const width = () => {
    if (props.width) return Math.max(24, props.width)
    if (measured() > 0) return Math.max(24, measured())
    const renderer = props.context.renderer.width
    return Math.max(24, (typeof renderer === "number" && renderer > 0 ? renderer : 100) - 8)
  }

  /** Never eat more than half the pane; the composer and the chat stay visible. */
  const maxLines = () => {
    const height = props.context.renderer.height
    const rows = typeof height === "number" && height > 0 ? height : 30
    return Math.max(6, Math.min(30, Math.floor(rows / 2)))
  }

  const lines = () => layoutCard(props.card, width(), maxLines())

  return (
    <box
      ref={(element: { width?: number } | null) => {
        box = element
        measure()
      }}
      onSizeChange={measure}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text fg={theme().hue.cyan[400]}>
          {fit(props.card.title, width() - displayWidth(CLOSE_LABEL) - 1)}
        </text>
        <text
          selectable={false}
          fg={hovering() ? theme().text.feedback.error.base : theme().text.muted}
          onMouseDown={() => props.onClose()}
          onMouseOver={() => setHovering(true)}
          onMouseOut={() => setHovering(false)}
        >
          {CLOSE_LABEL}
        </text>
      </box>
      <For each={lines()}>{(line) => <text fg={theme().text.base}>{line}</text>}</For>
    </box>
  )
}
