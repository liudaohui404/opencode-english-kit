/**
 * Minimal ambient declaration for the Bun built-in used by `local.ts`.
 *
 * The runtime (Bun) supplies the real implementation; this only exists so the
 * plugin typechecks without pulling in `bun-types`.
 */
declare module "bun:sqlite" {
  export interface Statement {
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): unknown
  }

  export class Database {
    constructor(path: string, options?: { readonly?: boolean; create?: boolean })
    query(sql: string): Statement
    run(sql: string): unknown
    close(): void
  }
}
