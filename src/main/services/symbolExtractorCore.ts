/**
 * Task 10.2-3 — the symbol extractor. TEXT IN, ROWS OUT.
 *
 * PURE: no `fs`, no `git`, no driver, no electron. `memoryService.index` owns
 * every read and every write and calls this the way it calls `buildRows` —
 * which keeps the extractor testable from a string, and keeps the bolt session
 * from being held open across a parse (`index` parses first, then opens it).
 *
 * ⚠ THE PARSE IS SYNTACTIC, PER FILE (D205). `ts.createSourceFile`, never a
 * `Program`, never a type checker, never `tsconfig`. `:Symbol` and `DEFINED_IN`
 * are EXACT. `CALLS` and `REFERENCES` are resolved from what the syntax itself
 * proves, and every edge says how confident that proof is (D208) — the reader
 * shows both labels (D210).
 *
 * ⚠⚠ WHY RESOLUTION IS NOT "MATCH THE NAME ACROSS THE REPO" — MEASURED, NOT
 * ASSUMED. The first cut of this module did exactly that, and run over this
 * repository it produced 5,473 `CALLS` edges of which **72.2% were ambiguous**,
 * led by `get` (534), `push` (460), `add` (165) and `emit` (150): Array, Map
 * and Set builtins colliding with repo methods that happen to share the name.
 * Worse than the ambiguity, when exactly ONE repo method is named `push`, every
 * `arr.push(x)` in the codebase was labelled `unique` — a confident wrong
 * answer, which is the single failure D208 and D210 exist to prevent.
 *
 * So resolution uses what syntax DOES prove, and nothing it does not:
 *   - a bare name bound by an `import` resolves in the module it names;
 *   - `this.foo()` resolves among the enclosing class's own members;
 *   - a bare name that is neither imported nor declared in the file is a
 *     global, a parameter or a local — NOT a repo symbol, so no edge;
 *   - `x.foo()` on an unknown receiver is the one genuine guess, and it is
 *     ⚠ NEVER labelled `unique`, however few symbols share the name. A unique
 *     NAME is not a unique TARGET: the receiver may be any object, including
 *     one from a library the index has never seen.
 *
 * ⚠ TWO IMPORT FORMS, AND NEITHER IS A STYLE CHOICE — BOTH WERE MEASURED.
 * `@vue/compiler-sfc` sets `__esModule: true` and has NO `default` export, so
 * `import sfc from '@vue/compiler-sfc'` is `undefined` at runtime — in the
 * packaged app only, where this module is externalized. It must be a named
 * import. `typescript` has no `__esModule` today; the namespace form is used so
 * a future release that adds the flag cannot break it the same way.
 *
 * ⚠ WHAT A `:Symbol` MAY HOLD, DECIDED RATHER THAN DRIFTED INTO (Phase 10.2
 * overview §3): a NAME, a KIND, a PATH and a LINE. Never source text, never a
 * signature, never a doc comment — D149's posture.
 */
import * as ts from 'typescript'
import { parse as parseSfc } from '@vue/compiler-sfc'

/* ───────────────────────── the closed vocabulary ───────────────────────── */

/**
 * ⚠ A CLOSED SET, AND WIDENING IT RE-KEYS NODES. `kind` is inside `symbolId`
 * (D202), so adding a member changes the identity of every symbol it applies
 * to. The test pins the list.
 *
 * `const` is a function-valued `const`/`let` — `const run = () => …` — kept
 * distinct from `function run` so both can exist in one file without colliding.
 * `variable` is reserved by D202's grammar and NOT emitted: an index of every
 * variable would bury the callable symbols it exists to find.
 */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'const'
  | 'variable'

export const SYMBOL_KINDS: readonly SymbolKind[] = [
  'function',
  'method',
  'class',
  'interface',
  'type',
  'enum',
  'const',
  'variable'
]

/** What a call can land on. A class is reached by `new`, not by a call. */
const CALLABLE_KINDS: ReadonlySet<SymbolKind> = new Set<SymbolKind>(['function', 'method', 'const'])
/** What a type annotation or a heritage clause can name. */
const TYPE_KINDS: ReadonlySet<SymbolKind> = new Set<SymbolKind>(['class', 'interface', 'type', 'enum'])
/** What `new X()` can construct. */
const CONSTRUCTIBLE_KINDS: ReadonlySet<SymbolKind> = new Set<SymbolKind>(['class'])

export type Resolution = 'unique' | 'ambiguous'

/**
 * ⚠ MEMBER NAMES THE LANGUAGE ITSELF DEFINES — DERIVED FROM THE RUNTIME, NOT
 * HAND-CURATED.
 *
 * Measured on this repository before this existed: of 3,121 ambiguous `CALLS`
 * edges, the heaviest callee names were `get` (528), `push` (456), `add` (161)
 * and `test` (106). Every one is an Array, Map, Set or RegExp method, and every
 * such edge claimed that `arr.push(x)` might call some repo method that happens
 * to be named `push`. On an unknown receiver the syntax cannot tell the two
 * apart, and the builtin reading is overwhelmingly the true one.
 *
 * So a call on an UNKNOWN receiver whose name a builtin prototype defines gets
 * no edge. ⚠ THE COST IS REAL AND IS COUNTED, NOT HIDDEN: a repo method that
 * shares a builtin's name (a `Registry.get`) loses its unknown-receiver callers.
 * `this.get()` is unaffected — it resolves through its own class — and the
 * dropped sites are reported as `sitesBuiltinShaped`.
 *
 * EventEmitter/EventTarget names are added because they are as ubiquitous as
 * the prototypes and just as unresolvable. Stream methods (`write`, `end`) are
 * NOT: `SessionManager.write` is one of this repository's most-called methods.
 */
const BUILTIN_MEMBER_NAMES: ReadonlySet<string> = (() => {
  const names = new Set<string>()
  const typedArrayProto = Object.getPrototypeOf(Uint8Array.prototype) as object
  const protos: object[] = [
    Array.prototype,
    String.prototype,
    Number.prototype,
    Boolean.prototype,
    Object.prototype,
    Function.prototype,
    Promise.prototype,
    RegExp.prototype,
    Date.prototype,
    Map.prototype,
    Set.prototype,
    WeakMap.prototype,
    WeakSet.prototype,
    ArrayBuffer.prototype,
    typedArrayProto
  ]
  for (const p of protos) for (const n of Object.getOwnPropertyNames(p)) if (n !== 'constructor') names.add(n)
  for (const n of [
    'on',
    'once',
    'off',
    'emit',
    'addListener',
    'removeListener',
    'removeAllListeners',
    'prependListener',
    'listeners',
    'listenerCount',
    'addEventListener',
    'removeEventListener',
    'dispatchEvent'
  ]) {
    names.add(n)
  }
  return names
})()

/** Exposed for the test that pins the builtin exclusion to the runtime. */
export function isBuiltinMemberName(name: string): boolean {
  return BUILTIN_MEMBER_NAMES.has(name)
}

/* ───────────────────────── rows ───────────────────────── */

export interface SymbolRow {
  readonly symbolId: string
  readonly name: string
  readonly kind: SymbolKind
  readonly relPath: string
  /** The qualified name minus its last segment; null at module scope. */
  readonly containerName: string | null
  /** 1-based, in the ORIGINAL file — for a `.vue` file, the `.vue`'s line. */
  readonly line: number
}

export interface DefinedInRow {
  readonly symbolId: string
  readonly relPath: string
}

export interface CallRow {
  readonly callerId: string
  readonly calleeId: string
  readonly resolution: Resolution
}

export interface ReferenceRow {
  readonly srcId: string
  readonly dstId: string
  readonly resolution: Resolution
}

/**
 * What the syntax proved about where a name comes from.
 *
 * - `import`: bound by an import of `specifier`; `importedName` is the exported
 *   name (`'default'` for a default import, the member name for `ns.foo`).
 * - `this`: `this.foo`, where `container` is the qualified name `this` is bound
 *   to — a class, or the object literal a method sits in (a Pinia options
 *   store's `actions`). Null when `this` is dynamic and cannot be traced.
 * - `file`: a bare name not imported — resolvable only among this file's own
 *   symbols; if it is not one, it is a global or a local and gets no edge.
 * - `member`: `x.foo` on a receiver the syntax cannot type. `receiverSpecifier`
 *   is set when the chain's root is itself an import, so a library receiver
 *   (`path.join`, `neo4j.driver`) can be recognised and dropped.
 */
export type NameScope =
  | { readonly kind: 'import'; readonly specifier: string; readonly importedName: string }
  | { readonly kind: 'this'; readonly container: string | null }
  | { readonly kind: 'file' }
  | { readonly kind: 'member'; readonly receiverSpecifier: string | null }

/** A use of a name, recorded per file and resolved once every file is read. */
export interface NameSite {
  /** The innermost enclosing symbol; null for code at module scope. */
  readonly fromId: string | null
  readonly name: string
  readonly role: 'call' | 'reference'
  readonly targets: ReadonlySet<SymbolKind>
  readonly scope: NameScope
}

/* ───────────────────────── which files ───────────────────────── */

const SCRIPT_KIND_BY_EXT: Readonly<Record<string, ts.ScriptKind>> = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX
}

/**
 * ⚠ LANGUAGES NAMED, NOT "OTHER". The index report tells a Python project that
 * its Python was not indexed — the spec's own honesty requirement — so an
 * unsupported file has to be recognised as source in a language before it can
 * be counted as one. A `.md` or `.json` is not "unsupported source"; it is not
 * source, and counting it would inflate the number the UI shows.
 */
const UNSUPPORTED_LANGUAGE_BY_EXT: Readonly<Record<string, string>> = {
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.c': 'C',
  '.h': 'C',
  '.swift': 'Swift',
  '.scala': 'Scala'
}

export type SourceClass =
  | { readonly kind: 'supported' }
  | { readonly kind: 'unsupported'; readonly language: string }
  | { readonly kind: 'not-source' }

const extOf = (relPath: string): string => {
  const slash = relPath.lastIndexOf('/')
  const dot = relPath.lastIndexOf('.')
  return dot > slash ? relPath.slice(dot).toLowerCase() : ''
}

/**
 * ⚠ `.d.ts` IS NOT INDEXED. A declaration file restates symbols that live
 * elsewhere, so indexing it would put a second `:Symbol` beside every real one
 * and make every reference to it AMBIGUOUS — manufacturing uncertainty from
 * files that contain no calls at all.
 */
export function classifySource(relPath: string): SourceClass {
  if (/\.d\.[cm]?ts$/i.test(relPath)) return { kind: 'not-source' }
  const ext = extOf(relPath)
  if (ext === '.vue' || ext in SCRIPT_KIND_BY_EXT) return { kind: 'supported' }
  const language = UNSUPPORTED_LANGUAGE_BY_EXT[ext]
  return language ? { kind: 'unsupported', language } : { kind: 'not-source' }
}

/* ───────────────────────── one file ───────────────────────── */

export type FileExtraction =
  | {
      readonly ok: true
      readonly relPath: string
      readonly symbols: readonly SymbolRow[]
      /** Consumed by `resolveEdges`; carries names only, never source text. */
      readonly sites: readonly NameSite[]
    }
  | {
      readonly ok: false
      readonly relPath: string
      /**
       * `hash-in-path`: D202's grammar splits on `#`, so a path containing one
       * would produce an id that cannot be read back. SKIPPED AND COUNTED,
       * never escaped — a silent mis-parse is worse than a named omission.
       */
      readonly reason: 'hash-in-path' | 'unsupported' | 'unparseable'
    }

interface Block {
  readonly code: string
  readonly scriptKind: ts.ScriptKind
  /** Lines before the block starts, so a block line maps back to the file. */
  readonly lineOffset: number
}

function blocksOf(relPath: string, text: string): readonly Block[] | null {
  const ext = extOf(relPath)
  if (ext !== '.vue') {
    const scriptKind = SCRIPT_KIND_BY_EXT[ext]
    return scriptKind === undefined ? null : [{ code: text, scriptKind, lineOffset: 0 }]
  }

  const { descriptor, errors } = parseSfc(text, { filename: relPath })
  // ⚠ BOTH BLOCKS. `<script>` beside `<script setup>` is ordinary Vue, and
  // taking only one would drop real symbols without a word.
  const raw = [descriptor.script, descriptor.scriptSetup].filter(
    (b): b is NonNullable<typeof b> => b !== null && b !== undefined
  )
  if (raw.length === 0) {
    // A template-only component is normal and yields no symbols. Only a file
    // that ALSO failed to parse is reported as unparseable.
    return errors.length > 0 ? null : []
  }
  return raw.map((b) => {
    const lang = (b.lang ?? 'js').toLowerCase()
    const scriptKind =
      lang === 'tsx'
        ? ts.ScriptKind.TSX
        : lang === 'ts'
          ? ts.ScriptKind.TS
          : lang === 'jsx'
            ? ts.ScriptKind.JSX
            : ts.ScriptKind.JS
    // ⚠ WITHOUT THIS EVERY SYMBOL IN A .vue FILE CARRIES THE WRONG LINE, and a
    // test asserting only a symbol's name would never notice.
    const lineOffset = text.slice(0, b.loc.start.offset).split('\n').length - 1
    return { code: b.content, scriptKind, lineOffset }
  })
}

const identifierText = (n: ts.Node | undefined): string | null =>
  n !== undefined && (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) ? n.text : null

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind)

const isFunctionValued = (e: ts.Expression | undefined): boolean =>
  e !== undefined && (ts.isArrowFunction(e) || ts.isFunctionExpression(e))

/**
 * The declaration a node introduces, if it is one this index records.
 *
 * ⚠ OVERLOAD SIGNATURES ARE NOT SYMBOLS. `function f(a: string): void;` is a
 * body-less declaration standing beside the implementation; recording it would
 * put three `:Symbol`s named `f` in one file and make every call to `f`
 * ambiguous when there is exactly one function. A `declare`d function and an
 * `abstract` method have no body either, and ARE real targets.
 */
function declarationOf(n: ts.Node): { name: string; kind: SymbolKind; nameNode: ts.Node } | null {
  if (ts.isFunctionDeclaration(n) && n.name) {
    if (n.body === undefined && !hasModifier(n, ts.SyntaxKind.DeclareKeyword)) return null
    return { name: n.name.text, kind: 'function', nameNode: n.name }
  }
  if (ts.isMethodDeclaration(n)) {
    const name = identifierText(n.name)
    if (name === null) return null
    if (n.body === undefined && !hasModifier(n, ts.SyntaxKind.AbstractKeyword)) return null
    return { name, kind: 'method', nameNode: n.name }
  }
  if (ts.isClassDeclaration(n) && n.name) return { name: n.name.text, kind: 'class', nameNode: n.name }
  if (ts.isInterfaceDeclaration(n)) return { name: n.name.text, kind: 'interface', nameNode: n.name }
  if (ts.isTypeAliasDeclaration(n)) return { name: n.name.text, kind: 'type', nameNode: n.name }
  if (ts.isEnumDeclaration(n)) return { name: n.name.text, kind: 'enum', nameNode: n.name }
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isFunctionValued(n.initializer)) {
    return { name: n.name.text, kind: 'const', nameNode: n.name }
  }
  if (ts.isPropertyDeclaration(n) && isFunctionValued(n.initializer)) {
    const name = identifierText(n.name)
    return name === null ? null : { name, kind: 'method', nameNode: n.name }
  }
  return null
}

/** A node whose name becomes part of a descendant's qualified name. */
function containerNameOf(n: ts.Node): string | null {
  if ((ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isFunctionDeclaration(n)) && n.name) {
    return n.name.text
  }
  if (ts.isInterfaceDeclaration(n) || ts.isEnumDeclaration(n)) return n.name.text
  if (ts.isModuleDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text
  if (ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n)) return identifierText(n.name)
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text
  // `defineStore('x', { actions: { load() {} } })` qualifies as
  // `useXStore.actions.load` — readable, and it is how this codebase is shaped.
  if (ts.isPropertyAssignment(n)) {
    return ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : null
  }
  return null
}

function qualifiedPrefix(node: ts.Node): string[] {
  const chain: string[] = []
  for (let p = node.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
    const name = containerNameOf(p)
    if (name !== null) chain.push(name)
  }
  return chain.reverse()
}

interface ImportBinding {
  readonly specifier: string
  /** The exported name; `'*'` for a namespace import, `'default'` for a default. */
  readonly importedName: string
}

function importsOf(sf: ts.SourceFile, into: Map<string, ImportBinding>): void {
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const specifier = st.moduleSpecifier.text
    const clause = st.importClause
    if (!clause) continue
    if (clause.name) into.set(clause.name.text, { specifier, importedName: 'default' })
    const nb = clause.namedBindings
    if (nb && ts.isNamespaceImport(nb)) into.set(nb.name.text, { specifier, importedName: '*' })
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        into.set(el.name.text, { specifier, importedName: (el.propertyName ?? el.name).text })
      }
    }
  }
}

/** The leftmost identifier of `a.b.c` — or `this` — so a chain can be traced to its origin. */
function chainRoot(e: ts.Expression): ts.Expression {
  let cur = e
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = cur.expression
  return cur
}

/**
 * The qualified name `this` is bound to at `node`, or null when it cannot be
 * traced.
 *
 * ⚠ ARROW FUNCTIONS ARE SKIPPED: their `this` is LEXICAL, so an arrow inside a
 * method still sees the method's `this`. A plain `function` rebinds it
 * dynamically, and nothing syntactic says to what.
 *
 * ⚠ AND `this` IS NOT ONLY A CLASS. In a Pinia options store, `this.refuse()`
 * inside `actions.load()` calls the sibling action `actions.refuse` — measured
 * as 162 ambiguous edges before this case existed. A method in an object
 * literal binds `this` to that object, whose members share one container name.
 */
function thisContainerOf(node: ts.Node): string | null {
  for (let p = node.parent; p !== undefined; p = p.parent) {
    if (ts.isArrowFunction(p)) continue
    if (ts.isClassDeclaration(p) || ts.isClassExpression(p)) {
      return p.name ? [...qualifiedPrefix(p), p.name.text].join('.') : null
    }
    const isObjectMethod =
      (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) &&
      ts.isObjectLiteralExpression(p.parent)
    const isObjectFunctionProp =
      ts.isFunctionExpression(p) && ts.isPropertyAssignment(p.parent) && ts.isObjectLiteralExpression(p.parent.parent)
    if (isObjectMethod || isObjectFunctionProp) {
      const prefix = qualifiedPrefix(isObjectMethod ? p : p.parent)
      return prefix.length > 0 ? prefix.join('.') : null
    }
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) return null
  }
  return null
}

/**
 * Where a callee/constructor/heritage expression's name comes from, or null
 * when the syntax offers no name at all (`obj['x']()`, `(await f)()`).
 */
function scopeOfExpression(
  e: ts.Expression,
  node: ts.Node,
  imports: ReadonlyMap<string, ImportBinding>
): { name: string; scope: NameScope } | null {
  if (ts.isIdentifier(e)) {
    const b = imports.get(e.text)
    return b
      ? { name: e.text, scope: { kind: 'import', specifier: b.specifier, importedName: b.importedName } }
      : { name: e.text, scope: { kind: 'file' } }
  }
  if (!ts.isPropertyAccessExpression(e)) return null
  const name = identifierText(e.name)
  if (name === null) return null
  if (e.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return { name, scope: { kind: 'this', container: thisContainerOf(node) } }
  }
  // `ns.foo()` on a namespace import is as certain as a named import of `foo`.
  if (ts.isIdentifier(e.expression)) {
    const b = imports.get(e.expression.text)
    if (b && b.importedName === '*') {
      return { name, scope: { kind: 'import', specifier: b.specifier, importedName: name } }
    }
  }
  const root = chainRoot(e.expression)
  const rootImport = ts.isIdentifier(root) ? imports.get(root.text) : undefined
  return { name, scope: { kind: 'member', receiverSpecifier: rootImport?.specifier ?? null } }
}

/**
 * Extract one file. Never throws: an unsupported or unreadable file is a named
 * refusal in the result, because one bad file must not abort an index of 260.
 */
export function extractFile(relPath: string, text: string): FileExtraction {
  if (relPath.includes('#')) return { ok: false, relPath, reason: 'hash-in-path' }
  if (classifySource(relPath).kind !== 'supported') return { ok: false, relPath, reason: 'unsupported' }

  let blocks: readonly Block[] | null
  try {
    blocks = blocksOf(relPath, text)
  } catch {
    return { ok: false, relPath, reason: 'unparseable' }
  }
  if (blocks === null) return { ok: false, relPath, reason: 'unparseable' }

  const sources = blocks.map((b) => ({
    block: b,
    sf: ts.createSourceFile(relPath, b.code, ts.ScriptTarget.Latest, true, b.scriptKind)
  }))
  // ⚠ ONE IMPORT MAP ACROSS BOTH .vue BLOCKS: `<script setup>` sees the plain
  // block's imports, so resolving each block against only its own would call
  // an imported function a global.
  const imports = new Map<string, ImportBinding>()
  for (const { sf } of sources) importsOf(sf, imports)

  const symbols: SymbolRow[] = []
  const sites: NameSite[] = []
  // ⚠ SHARED ACROSS BOTH .vue BLOCKS for the same reason: one file is one
  // namespace of ids, and separate counters would issue the same id twice.
  const seen = new Map<string, number>()

  for (const { block, sf } of sources) {
    const idByNode = new Map<ts.Node, string>()
    const enclosingId = (node: ts.Node): string | null => {
      for (let p = node.parent; p !== undefined; p = p.parent) {
        const id = idByNode.get(p)
        if (id !== undefined) return id
      }
      return null
    }
    const record = (
      node: ts.Node,
      found: { name: string; scope: NameScope } | null,
      role: NameSite['role'],
      targets: ReadonlySet<SymbolKind>
    ): void => {
      if (found !== null) sites.push({ fromId: enclosingId(node), name: found.name, role, targets, scope: found.scope })
    }

    const visit = (n: ts.Node): void => {
      const decl = declarationOf(n)
      if (decl !== null) {
        const prefix = qualifiedPrefix(n)
        const base = `${relPath}#${[...prefix, decl.name].join('.')}:${decl.kind}`
        const count = (seen.get(base) ?? 0) + 1
        seen.set(base, count)
        // First occurrence carries no suffix; later ones are `@2`, `@3`… in
        // SOURCE ORDER. ⚠ Positional, so removing the first renumbers the rest —
        // survivable only because a vanished id is marked, never deleted.
        const symbolId = count === 1 ? base : `${base}@${count}`
        idByNode.set(n, symbolId)
        const pos = sf.getLineAndCharacterOfPosition(decl.nameNode.getStart(sf))
        symbols.push({
          symbolId,
          name: decl.name,
          kind: decl.kind,
          relPath,
          containerName: prefix.length > 0 ? prefix.join('.') : null,
          line: pos.line + 1 + block.lineOffset
        })
      }

      if (ts.isCallExpression(n)) {
        record(n, scopeOfExpression(n.expression, n, imports), 'call', CALLABLE_KINDS)
      } else if (ts.isNewExpression(n)) {
        record(n, scopeOfExpression(n.expression, n, imports), 'reference', CONSTRUCTIBLE_KINDS)
      } else if (ts.isTypeReferenceNode(n)) {
        const t = n.typeName
        const expr = ts.isIdentifier(t) ? t : undefined
        if (expr) record(n, scopeOfExpression(expr, n, imports), 'reference', TYPE_KINDS)
        else if (ts.isQualifiedName(t) && ts.isIdentifier(t.left)) {
          const b = imports.get(t.left.text)
          record(
            n,
            b && b.importedName === '*'
              ? { name: t.right.text, scope: { kind: 'import', specifier: b.specifier, importedName: t.right.text } }
              : { name: t.right.text, scope: { kind: 'member', receiverSpecifier: b?.specifier ?? null } },
            'reference',
            TYPE_KINDS
          )
        }
      } else if (ts.isExpressionWithTypeArguments(n) && ts.isHeritageClause(n.parent)) {
        record(n, scopeOfExpression(n.expression, n, imports), 'reference', TYPE_KINDS)
      }

      ts.forEachChild(n, visit)
    }
    visit(sf)
  }

  return { ok: true, relPath, symbols, sites }
}

/* ───────────────────────── module resolution ───────────────────────── */

const STRIPPABLE_EXT = /\.(?:[cm]?[jt]sx?|vue)$/i

function posixDirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

function posixJoin(dir: string, rel: string): string | null {
  const out: string[] = dir === '' ? [] : dir.split('/')
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      // Escaping the repository root cannot name a tracked file.
      if (out.length === 0) return null
      out.pop()
    } else out.push(seg)
  }
  return out.join('/')
}

/**
 * The repository files an import specifier can name. EMPTY MEANS "NOT THIS
 * REPOSITORY" — a package, a builtin, a `node:` module — and such a name gets
 * no edge, which is the correct output for a library call.
 *
 * ⚠ ALIASES ARE MATCHED BY SUFFIX, NOT BY READING CONFIG. This indexer runs on
 * any project a user opens, so `tsconfig` paths and bundler aliases cannot be
 * known here. `@renderer/stores/memory` is tried as written and then with its
 * leading `@alias` segment dropped, and matches a tracked file ending in
 * `/stores/memory`. A scoped PACKAGE like `@vue/compiler-sfc` matches nothing
 * in the tree, so it stays a library. ⚠ The known cost: a repository file whose
 * path happens to end like a package subpath would be mistaken for it.
 */
function makeModuleResolver(files: readonly string[]): (from: string, specifier: string) => readonly string[] {
  const byStem = new Map<string, string[]>()
  const add = (stem: string, rel: string): void => {
    const list = byStem.get(stem)
    if (list) {
      if (!list.includes(rel)) list.push(rel)
    } else byStem.set(stem, [rel])
  }
  for (const rel of files) {
    const stem = rel.replace(STRIPPABLE_EXT, '')
    add(stem, rel)
    if (stem.endsWith('/index')) add(stem.slice(0, -'/index'.length), rel)
  }
  const stems = [...byStem.keys()]

  return (from, specifier) => {
    if (specifier.includes(':')) return [] // `node:fs`, `electron:`… never a tracked file
    const spec = specifier.replace(STRIPPABLE_EXT, '')
    if (spec.startsWith('.')) {
      const joined = posixJoin(posixDirname(from), spec)
      return joined === null ? [] : (byStem.get(joined) ?? [])
    }
    if (spec.startsWith('/')) return byStem.get(spec.slice(1)) ?? []
    const segs = spec.split('/')
    // A bare package (`zod`, `vue`) or its subpath with no alias segment.
    const tries = [spec]
    if (segs.length > 1 && /^[@~#]/.test(segs[0])) tries.push(segs.slice(1).join('/'))
    for (const t of tries) {
      if (!t.includes('/')) continue // a single segment is a package name, never a suffix match
      const hits = stems.filter((s) => s === t || s.endsWith('/' + t))
      if (hits.length > 0) return hits.flatMap((h) => byStem.get(h) ?? [])
    }
    return []
  }
}

/* ───────────────────────── every file ───────────────────────── */

export interface EdgeStats {
  /** Uses of a name that could have become an edge. */
  readonly sites: number
  /** Code at module scope — test bodies, lifecycle callbacks — has no enclosing symbol to be an edge's source. */
  readonly sitesAtModuleScope: number
  /** A library, a global, a parameter or a local value: not a repository symbol. The correct output is silence. */
  readonly sitesExternal: number
  /**
   * A call on an unknown receiver whose name a builtin prototype defines
   * (`arr.push`, `map.get`). ⚠ Dropped deliberately, and COUNTED because the
   * drop can hide a real caller of a repo method that shares a builtin's name.
   */
  readonly sitesBuiltinShaped: number
  readonly callEdges: number
  readonly callEdgesAmbiguous: number
  readonly referenceEdges: number
  readonly referenceEdgesAmbiguous: number
}

export interface ResolvedEdges {
  readonly calls: readonly CallRow[]
  readonly references: readonly ReferenceRow[]
  readonly stats: EdgeStats
}

/**
 * Resolve every recorded use against every symbol THIS RUN found.
 *
 * ⚠ SCOPED TO ONE INDEX RUN, WHICH IS ONE WORKSPACE INSTANCE. A symbol from
 * another project that shares a name is never a candidate, because it is never
 * in the maps.
 *
 * ⚠ `unique` IS A CLAIM ABOUT THE TARGET, NOT ABOUT THE NAME. It is issued only
 * when the syntax traced the name to one symbol — through an import, through
 * `this`, or within the file. Every fallback, and every call on an unknown
 * receiver, is `ambiguous` however few candidates it found.
 */
export function resolveEdges(files: readonly FileExtraction[]): ResolvedEdges {
  const okFiles = files.filter((f): f is Extract<FileExtraction, { ok: true }> => f.ok)
  const byName = new Map<string, SymbolRow[]>()
  const byFile = new Map<string, readonly SymbolRow[]>()
  for (const f of okFiles) {
    byFile.set(f.relPath, f.symbols)
    for (const s of f.symbols) {
      const list = byName.get(s.name)
      if (list) list.push(s)
      else byName.set(s.name, [s])
    }
  }
  const resolveModule = makeModuleResolver(okFiles.map((f) => f.relPath))

  const calls = new Map<string, CallRow>()
  const references = new Map<string, ReferenceRow>()
  let sites = 0
  let sitesAtModuleScope = 0
  let sitesExternal = 0
  let sitesBuiltinShaped = 0

  const fits = (s: SymbolRow, site: NameSite, name = site.name): boolean =>
    s.name === name && site.targets.has(s.kind)

  for (const f of okFiles) {
    for (const site of f.sites) {
      sites++
      if (site.fromId === null) {
        sitesAtModuleScope++
        continue
      }

      let hits: readonly SymbolRow[] = []
      let resolution: Resolution = 'ambiguous'
      const sc = site.scope

      if (sc.kind === 'file') {
        hits = (byFile.get(f.relPath) ?? []).filter((s) => fits(s, site))
        resolution = hits.length === 1 ? 'unique' : 'ambiguous'
      } else if (sc.kind === 'this') {
        hits = (byFile.get(f.relPath) ?? []).filter(
          (s) => fits(s, site) && sc.container !== null && s.containerName === sc.container
        )
        if (hits.length > 0) resolution = hits.length === 1 ? 'unique' : 'ambiguous'
        else hits = (byName.get(site.name) ?? []).filter((s) => fits(s, site)) // inherited: a guess
      } else if (sc.kind === 'import') {
        const modules = resolveModule(f.relPath, sc.specifier)
        if (modules.length > 0) {
          const wanted = sc.importedName === 'default' || sc.importedName === '*' ? site.name : sc.importedName
          hits = modules.flatMap((m) => (byFile.get(m) ?? []).filter((s) => fits(s, site, wanted)))
          if (hits.length > 0) resolution = hits.length === 1 ? 'unique' : 'ambiguous'
          // A re-export through a barrel file: the name is real but lives elsewhere.
          else hits = (byName.get(wanted) ?? []).filter((s) => fits(s, site, wanted))
        }
      } else {
        const libraryReceiver = sc.receiverSpecifier !== null && resolveModule(f.relPath, sc.receiverSpecifier).length === 0
        if (!libraryReceiver && BUILTIN_MEMBER_NAMES.has(site.name)) {
          sitesBuiltinShaped++
          continue
        }
        if (!libraryReceiver) hits = (byName.get(site.name) ?? []).filter((s) => fits(s, site))
      }

      if (hits.length === 0) {
        sitesExternal++
        continue
      }
      for (const h of hits) {
        // One edge per (source, target). Where two sites disagree about how
        // confident an edge is, the CONFIDENT one wins: a proof from one call
        // site is not weakened by a guess at another.
        const key = `${site.fromId} ${h.symbolId}`
        if (site.role === 'call') {
          const prev = calls.get(key)
          if (!prev || (prev.resolution === 'ambiguous' && resolution === 'unique')) {
            calls.set(key, { callerId: site.fromId, calleeId: h.symbolId, resolution })
          }
        } else {
          const prev = references.get(key)
          if (!prev || (prev.resolution === 'ambiguous' && resolution === 'unique')) {
            references.set(key, { srcId: site.fromId, dstId: h.symbolId, resolution })
          }
        }
      }
    }
  }

  const callRows = [...calls.values()]
  const referenceRows = [...references.values()]
  return {
    calls: callRows,
    references: referenceRows,
    stats: {
      sites,
      sitesAtModuleScope,
      sitesExternal,
      sitesBuiltinShaped,
      callEdges: callRows.length,
      callEdgesAmbiguous: callRows.filter((c) => c.resolution === 'ambiguous').length,
      referenceEdges: referenceRows.length,
      referenceEdgesAmbiguous: referenceRows.filter((r) => r.resolution === 'ambiguous').length
    }
  }
}

export function definedInRows(files: readonly FileExtraction[]): DefinedInRow[] {
  const out: DefinedInRow[] = []
  for (const f of files) {
    if (!f.ok) continue
    for (const s of f.symbols) out.push({ symbolId: s.symbolId, relPath: s.relPath })
  }
  return out
}

/**
 * The files an index run should hand to `extractFile`, and the honest count of
 * the ones it should not. Computed from the tracked path list alone, so the
 * report can name what was left out before a single file is read.
 */
export function planSymbolSources(trackedPaths: readonly string[]): {
  readonly supported: readonly string[]
  readonly unsupportedCount: number
  /** Distinct, sorted — what the UI names: "Python and Go were not indexed". */
  readonly unsupportedLanguages: readonly string[]
} {
  const supported: string[] = []
  const languages = new Set<string>()
  let unsupportedCount = 0
  for (const p of trackedPaths) {
    const c = classifySource(p)
    if (c.kind === 'supported') supported.push(p)
    else if (c.kind === 'unsupported') {
      unsupportedCount++
      languages.add(c.language)
    }
  }
  return { supported, unsupportedCount, unsupportedLanguages: [...languages].sort() }
}
