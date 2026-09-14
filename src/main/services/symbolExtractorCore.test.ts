import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifySource,
  definedInRows,
  extractFile,
  isBuiltinMemberName,
  planSymbolSources,
  resolveEdges,
  SYMBOL_KINDS,
  type FileExtraction,
  type SymbolRow
} from './symbolExtractorCore'

/**
 * Task 10.2-3's pure core.
 *
 * ⚠ THE CASES THAT MATTER MOST ARE THE ONES WHERE A WRONG ANSWER LOOKS RIGHT:
 * an edge labelled `unique` that is really a guess, a `.vue` symbol on the wrong
 * line, two symbols sharing an id. Each fails silently in the graph, so each is
 * pinned here.
 */

const symbolsOf = (f: FileExtraction): readonly SymbolRow[] => {
  if (!f.ok) throw new Error(`expected ok, got ${f.reason}`)
  return f.symbols
}
const byName = (f: FileExtraction, name: string): SymbolRow => {
  const s = symbolsOf(f).find((x) => x.name === name)
  if (!s) throw new Error(`no symbol ${name}`)
  return s
}

describe('symbolExtractorCore — purity', () => {
  it('imports nothing impure: no fs, no git, no driver, no electron', () => {
    // ⚠ ASSERTED ON THE IMPORT STATEMENTS, NOT ON THE FILE'S TEXT. The module's
    // own header names `fs`, `git` and `electron` in the sentence that forbids
    // them; a gate over raw text would report the prose as a violation of
    // itself — the trap F120, F123 and F128 record six times.
    const src = readFileSync(join(__dirname, 'symbolExtractorCore.ts'), 'utf8')
    const specifiers = [...src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(specifiers).toEqual(['typescript', '@vue/compiler-sfc'])
  })

  it('⚠⚠ is never imported BY VALUE from production code — only by type, or dynamically', () => {
    // A value import would load `typescript` into main at BOOT: every launch pays
    // for it, and if D206's strip ever removed something it needs, Chorus would
    // not start at all. Verified in the built bundle on 2026-09-14 — `index.js`
    // reaches the extractor only through `Promise.resolve().then(() => require(…))`.
    // Structural: import STATEMENTS, not the text of comments that name the module.
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|vue)$/.test(name) && !/\.test\.ts$/.test(name) && name !== 'symbolExtractorCore.ts') {
          for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
            if (/^import\s+(?!type\b)[^;]*from\s+['"][^'"]*symbolExtractorCore['"]/.test(line)) offenders.push(p)
          }
        }
      }
    }
    walk(join(__dirname, '..', '..'))
    expect(offenders).toEqual([])
  })

  it('⚠ imports @vue/compiler-sfc by NAME — its default export is undefined at runtime', () => {
    // Measured: the package sets __esModule with no `default`, so a default
    // import is `undefined` — in the packaged app only, where it is externalized.
    const src = readFileSync(join(__dirname, 'symbolExtractorCore.ts'), 'utf8')
    expect(src).toMatch(/^import \{ parse as parseSfc \} from '@vue\/compiler-sfc'$/m)
    expect(src).not.toMatch(/^import \w+ from '@vue\/compiler-sfc'/m)
  })
})

describe('symbolExtractorCore — the closed vocabulary', () => {
  it('pins the kind list, because widening it re-keys nodes (D202)', () => {
    expect(SYMBOL_KINDS).toEqual(['function', 'method', 'class', 'interface', 'type', 'enum', 'const', 'variable'])
  })

  it('classifies source by extension, and never indexes a declaration file', () => {
    expect(classifySource('src/a.ts').kind).toBe('supported')
    expect(classifySource('src/a.vue').kind).toBe('supported')
    expect(classifySource('src/a.mjs').kind).toBe('supported')
    // A .d.ts restates symbols that live elsewhere: indexing it would make
    // every reference to them ambiguous.
    expect(classifySource('src/env.d.ts').kind).toBe('not-source')
    expect(classifySource('docs/readme.md').kind).toBe('not-source')
    expect(classifySource('tool/run.py')).toEqual({ kind: 'unsupported', language: 'Python' })
  })

  it('names unsupported LANGUAGES, and does not count non-source as unsupported', () => {
    const plan = planSymbolSources(['a.ts', 'b.py', 'c.py', 'd.go', 'README.md', 'x.json', 'e.d.ts'])
    expect(plan.supported).toEqual(['a.ts'])
    expect(plan.unsupportedCount).toBe(3)
    expect(plan.unsupportedLanguages).toEqual(['Go', 'Python'])
  })
})

describe('symbolExtractorCore — symbolId (D202)', () => {
  it('builds <relPath>#<qualifiedName>:<kind>', () => {
    const f = extractFile(
      'src/x.ts',
      'export function compose() {}\nexport class Session { write() {} }\nexport const run = () => 1\n'
    )
    expect(byName(f, 'compose').symbolId).toBe('src/x.ts#compose:function')
    expect(byName(f, 'Session').symbolId).toBe('src/x.ts#Session:class')
    expect(byName(f, 'write').symbolId).toBe('src/x.ts#Session.write:method')
    expect(byName(f, 'write').containerName).toBe('Session')
    expect(byName(f, 'run').symbolId).toBe('src/x.ts#run:const')
  })

  it('qualifies a Pinia options-store action by its object path', () => {
    const f = extractFile('s.ts', "export const useX = defineStore('x', { actions: { load() {} } })\n")
    expect(byName(f, 'load').symbolId).toBe('s.ts#useX.actions.load:method')
  })

  it('suffixes a repeated id with a SOURCE-ORDER ordinal, and never issues one id twice', () => {
    const f = extractFile('d.ts', 'if (a) { function f() {} } else { function f() {} }\n')
    const ids = symbolsOf(f).map((s) => s.symbolId)
    expect(ids).toEqual(['d.ts#f:function', 'd.ts#f:function@2'])
  })

  it('⚠ does NOT record overload signatures — one function must not look like three', () => {
    const f = extractFile('o.ts', 'function f(a: string): void\nfunction f(a: number): void\nfunction f(a: unknown) {}\n')
    expect(symbolsOf(f).filter((s) => s.name === 'f')).toHaveLength(1)
    expect(byName(f, 'f').symbolId).toBe('o.ts#f:function')
  })

  it('keeps a declared function and an abstract method, which have no body and are real', () => {
    const f = extractFile('a.ts', 'declare function g(): void\nabstract class A { abstract h(): void }\n')
    expect(symbolsOf(f).map((s) => s.name).sort()).toEqual(['A', 'g', 'h'])
  })

  it('⚠ SKIPS and names a path containing # rather than issuing an id that cannot be read back', () => {
    expect(extractFile('src/c#sharp.ts', 'function f() {}')).toEqual({
      ok: false,
      relPath: 'src/c#sharp.ts',
      reason: 'hash-in-path'
    })
  })

  it('reports lines 1-based', () => {
    expect(byName(extractFile('l.ts', '\n\nfunction here() {}\n'), 'here').line).toBe(3)
  })
})

describe('symbolExtractorCore — .vue', () => {
  it('⚠ maps line numbers back to the .vue FILE, not the script block', () => {
    // The script starts on line 5; a block-relative line would say 2.
    const vue = '<template>\n  <div />\n</template>\n\n<script setup lang="ts">\nfunction onClick() {}\n</script>\n'
    expect(byName(extractFile('C.vue', vue), 'onClick').line).toBe(6)
  })

  it('reads BOTH <script> and <script setup>, with one id namespace between them', () => {
    const vue =
      '<script lang="ts">\nexport function shared() {}\n</script>\n' +
      '<script setup lang="ts">\nfunction local() {}\n</script>\n<template><i /></template>\n'
    const names = symbolsOf(extractFile('Both.vue', vue)).map((s) => s.name)
    expect(names.sort()).toEqual(['local', 'shared'])
  })

  it('treats a template-only component as zero symbols, not as a failure', () => {
    const f = extractFile('T.vue', '<template><div /></template>\n')
    expect(f.ok).toBe(true)
    expect(symbolsOf(f)).toHaveLength(0)
  })
})

describe('symbolExtractorCore — resolution (D208)', () => {
  const run = (files: Record<string, string>) =>
    resolveEdges(Object.entries(files).map(([p, t]) => extractFile(p, t)))

  it('resolves a named import in the module it names, as UNIQUE', () => {
    const r = run({
      'src/a.ts': 'export function compose() {}',
      'src/b.ts': "import { compose } from './a'\nexport function caller() { compose() }"
    })
    expect(r.calls).toEqual([{ callerId: 'src/b.ts#caller:function', calleeId: 'src/a.ts#compose:function', resolution: 'unique' }])
  })

  it('follows an import alias to the EXPORTED name, and a namespace import to its member', () => {
    const r = run({
      'lib/core.ts': 'export function build() {}',
      'lib/use.ts':
        "import { build as b } from './core'\nimport * as core from './core'\nexport function one() { b() }\nexport function two() { core.build() }"
    })
    expect(r.calls.map((c) => [c.callerId.split('#')[1], c.resolution]).sort()).toEqual([
      ['one:function', 'unique'],
      ['two:function', 'unique']
    ])
  })

  it('resolves an aliased non-relative import by path SUFFIX, without reading config', () => {
    const r = run({
      'src/renderer/src/stores/memory.ts': 'export function refresh() {}',
      'src/renderer/src/view.ts': "import { refresh } from '@renderer/stores/memory'\nexport function v() { refresh() }"
    })
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0].resolution).toBe('unique')
  })

  it('⚠ gives a LIBRARY import no edge, even when a repo symbol shares the name', () => {
    const r = run({
      'src/mine.ts': 'export function parse() {}',
      'src/use.ts': "import { parse } from '@vue/compiler-sfc'\nexport function u() { parse() }"
    })
    expect(r.calls).toHaveLength(0)
    expect(r.stats.sitesExternal).toBe(1)
  })

  it('⚠ gives a bare GLOBAL call no edge — `setTimeout`, `expect` are not repo symbols', () => {
    const r = run({
      'src/timer.ts': 'export function setTimeout() {}',
      'src/use.ts': 'export function u() { setTimeout() }'
    })
    // Not imported and not declared in use.ts: the syntax says it is a global.
    expect(r.calls).toHaveLength(0)
  })

  it('resolves `this.foo()` within its own class', () => {
    const r = run({
      'src/s.ts': 'export class A { a() { this.b() } b() {} }\nexport class B { b() {} }'
    })
    expect(r.calls).toEqual([{ callerId: 'src/s.ts#A.a:method', calleeId: 'src/s.ts#A.b:method', resolution: 'unique' }])
  })

  it('resolves `this.foo()` between sibling actions of a Pinia options store', () => {
    const r = run({
      'src/store.ts': "export const useS = defineStore('s', { actions: { load() { this.refuse() }, refuse() {} } })"
    })
    expect(r.calls).toEqual([
      { callerId: 'src/store.ts#useS.actions.load:method', calleeId: 'src/store.ts#useS.actions.refuse:method', resolution: 'unique' }
    ])
  })

  it('keeps `this` lexical through an arrow function inside a method', () => {
    const r = run({ 'src/s.ts': 'export class A { a() { [1].forEach(() => this.b()) } b() {} }' })
    expect(r.calls.find((c) => c.calleeId === 'src/s.ts#A.b:method')?.resolution).toBe('unique')
  })

  it('⚠ NEVER labels a call on an unknown receiver `unique`, even with one candidate', () => {
    // A unique NAME is not a unique TARGET: `obj` may be any object at all.
    const r = run({
      'src/sm.ts': 'export class SessionManager { writeOut() {} }',
      'src/use.ts': 'export function u(obj: any) { obj.writeOut() }'
    })
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0].resolution).toBe('ambiguous')
  })

  it('⚠ drops a builtin-shaped call on an unknown receiver, and COUNTS the drop', () => {
    // Measured before this rule: `push` alone produced 456 edges claiming
    // `arr.push(x)` might call a repo method named `push`.
    const r = run({
      'src/buf.ts': 'export class Ring { push() {} }',
      'src/use.ts': 'export function u(arr: number[]) { arr.push(1) }'
    })
    expect(r.calls).toHaveLength(0)
    expect(r.stats.sitesBuiltinShaped).toBe(1)
  })

  it('still resolves `this.push()` inside a class that defines push', () => {
    const r = run({ 'src/buf.ts': 'export class Ring { add() { this.push() } push() {} }' })
    expect(r.calls[0]).toEqual({ callerId: 'src/buf.ts#Ring.add:method', calleeId: 'src/buf.ts#Ring.push:method', resolution: 'unique' })
  })

  it('pins the builtin set to the RUNTIME, including the names measured as noise', () => {
    for (const n of ['push', 'get', 'add', 'test', 'map', 'then', 'emit', 'on']) expect(isBuiltinMemberName(n)).toBe(true)
    // Stream methods are deliberately NOT builtins: SessionManager.write is real.
    for (const n of ['write', 'run', 'load', 'getCapabilities']) expect(isBuiltinMemberName(n)).toBe(false)
  })

  it('emits NO edge for code at module scope, and counts it', () => {
    const r = run({ 'src/a.ts': 'export function f() {}\nf()' })
    expect(r.calls).toHaveLength(0)
    expect(r.stats.sitesAtModuleScope).toBe(1)
  })

  it('⚠ labels every edge — an unlabelled edge would silently join the confident set', () => {
    const r = run({
      'src/a.ts': 'export function f() {}\nexport class K { m() {} }\nexport interface I {}',
      'src/b.ts': "import { f, K, type I } from './a'\nexport function g(o: any, i: I) { f(); o.m(); new K() }"
    })
    const all = [...r.calls, ...r.references]
    expect(all.length).toBeGreaterThan(0)
    for (const e of all) expect(['unique', 'ambiguous']).toContain(e.resolution)
  })

  it('resolves a type reference and `new` through imports as REFERENCES', () => {
    const r = run({
      'src/t.ts': 'export interface Opts {}\nexport class Box {}',
      'src/u.ts': "import { type Opts, Box } from './t'\nexport function make(o: Opts) { return new Box() }"
    })
    expect(r.references.map((x) => x.dstId).sort()).toEqual(['src/t.ts#Box:class', 'src/t.ts#Opts:interface'])
    for (const x of r.references) expect(x.resolution).toBe('unique')
  })

  it('lets a confident site win over a guess for the same edge', () => {
    const r = run({
      'src/a.ts': 'export class A { m() { this.n() } n() {} }\nexport function n2(o: any) {}',
      'src/b.ts': ''
    })
    const e = r.calls.find((c) => c.calleeId === 'src/a.ts#A.n:method')
    expect(e?.resolution).toBe('unique')
  })

  it('writes DEFINED_IN for every symbol, to its own file', () => {
    const files = [extractFile('src/a.ts', 'function f() {}\nclass C {}')]
    expect(definedInRows(files)).toEqual([
      { symbolId: 'src/a.ts#f:function', relPath: 'src/a.ts' },
      { symbolId: 'src/a.ts#C:class', relPath: 'src/a.ts' }
    ])
  })
})
