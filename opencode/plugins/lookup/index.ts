/**
 * Server-side entry for lookup.
 *
 * Lookups run in the terminal process against free HTTP endpoints, so there is
 * nothing to register on the server. This entry deliberately avoids importing
 * `@opencode/plugin`: the directory has no node_modules, so a bare import would
 * fail to resolve and OpenCode would report the plugin as failed.
 */
export default {
  id: "lookup",
  setup() {},
}
