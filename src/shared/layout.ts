/**
 * Owned binary split-tree pane layout model (decision D9 / CR-1.2).
 *
 * PURE TypeScript: no imports, no Zod, no runtime dependencies. This file is
 * loaded by the renderer (App.vue's flatten adapter), which runs under a CSP
 * with no `unsafe-eval` — a Zod import here would throw EvalError and
 * silently break IPC. Validation lives in src/shared/ipc.ts and is parsed
 * only in the main process (D1).
 *
 * Invariants (enforced here by construction; Zod-enforced at the storage and
 * IPC boundary):
 *   - internal nodes have exactly 2 children (the tuple type)
 *   - ratio clamped to [0.05, 0.95] on write AND on read (normalizeTree)
 *   - sessionId non-empty; no duplicate sessionIds (dedupe keep-first)
 *   - minimum valid tree is a single leaf; LayoutJson.version is literal 1
 */

export type LayoutLeaf = { type: 'leaf'; sessionId: string }

export type LayoutInternal = {
  type: 'row' | 'column'
  /** First child's fraction of the cross-axis, clamped to [0.05, 0.95]. */
  ratio: number
  children: [LayoutNode, LayoutNode]
}

export type LayoutNode = LayoutLeaf | LayoutInternal

export type LayoutJson = { version: 1; root: LayoutNode }

const MIN_RATIO = 0.05
const MAX_RATIO = 0.95

export function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

/** Create a leaf. Callers guarantee a non-empty sessionId (not thrown here). */
export function createLeaf(sessionId: string): LayoutLeaf {
  return { type: 'leaf', sessionId }
}

/**
 * Split the leaf for `targetSessionId` into an internal node holding the
 * original leaf (first child) and a new leaf (second child), ratio 0.5.
 * Unknown target or a duplicate newSessionId: returns the tree unchanged.
 *
 * ⚠ NO LONGER THE APP'S GROWTH PRIMITIVE — `appendPane` is (D174). Nothing
 * launches a pane into a chosen half any more, so no caller has a target or an
 * axis to pass. This survives as TREE ALGEBRA: it is the only operation here
 * that can build an arbitrary, unbalanced shape, which is exactly what the
 * read-path normalization (`normalizeTree`) needs to be fed by its tests, and
 * what a layout persisted before D174 already looks like on disk.
 */
export function splitPane(
  tree: LayoutNode,
  targetSessionId: string,
  direction: 'row' | 'column',
  newSessionId: string
): LayoutNode {
  if (findLeaf(tree, newSessionId)) return tree
  if (tree.type === 'leaf') {
    if (tree.sessionId !== targetSessionId) return tree
    return {
      type: direction,
      ratio: 0.5,
      children: [tree, createLeaf(newSessionId)]
    }
  }
  const left = splitPane(tree.children[0], targetSessionId, direction, newSessionId)
  const right = splitPane(tree.children[1], targetSessionId, direction, newSessionId)
  if (left === tree.children[0] && right === tree.children[1]) return tree
  return { ...tree, children: [left, right] }
}

/**
 * Build a balanced tree from an ORDERED list of session ids — the only shape a
 * layout takes now that panes flow and wrap (D174).
 *
 * `collectSessionIds(treeFromSessionIds(ids))` returns `ids` for any
 * duplicate-free list: document order in, document order out, and that
 * round-trip is the whole contract. Ratios come out even at every level, so the
 * persisted tree still describes what is on screen rather than recording drags
 * no splitter performs any more. Duplicates collapse keep-first; the empty list
 * is the empty layout (null), which is a legal state (Task 1-4).
 */
export function treeFromSessionIds(sessionIds: string[]): LayoutNode | null {
  const seen = new Set<string>()
  const leaves: LayoutLeaf[] = []
  for (const id of sessionIds) {
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    leaves.push(createLeaf(id))
  }
  return leaves.length === 0 ? null : buildBalanced(leaves)
}

/**
 * Append a pane at the END of document order — the ONE way a layout grows
 * (D174). There is no target and no axis to pass, because where a new pane
 * lands is a function of the WINDOW'S WIDTH and nothing else: the grid lays
 * panes out left to right and wraps them, so the tree's only job is to remember
 * the order they arrived in.
 *
 * A duplicate newSessionId returns the tree unchanged (the splitPane
 * precedent), and the result is never null — appending to a tree that already
 * holds a leaf cannot empty it.
 */
export function appendPane(tree: LayoutNode, newSessionId: string): LayoutNode {
  if (findLeaf(tree, newSessionId)) return tree
  return treeFromSessionIds([...collectSessionIds(tree), newSessionId]) ?? tree
}
/**
 * Remove the leaf for `sessionId`. The sibling absorbs the parent internal
 * node's slot. Removing the root's only leaf collapses the tree to null.
 * Unknown sessionId: returns the tree unchanged.
 */
export function removePane(tree: LayoutNode, sessionId: string): LayoutNode | null {
  if (tree.type === 'leaf') {
    return tree.sessionId === sessionId ? null : tree
  }
  const [left, right] = tree.children
  if (left.type === 'leaf' && left.sessionId === sessionId) return right
  if (right.type === 'leaf' && right.sessionId === sessionId) return left
  const newLeft = removePane(left, sessionId)
  if (newLeft === null) return right
  const newRight = removePane(right, sessionId)
  if (newRight === null) return left
  if (newLeft === left && newRight === right) return tree
  return { ...tree, children: [newLeft, newRight] }
}

/** Rebuild `tree` with `fn` applied to the node at `path`; no-op on an
 *  invalid path or when fn returns its input. */
function mapAtPath(
  tree: LayoutNode,
  path: (0 | 1)[],
  fn: (node: LayoutInternal) => LayoutInternal
): LayoutNode {
  if (path.length === 0) {
    return tree.type === 'leaf' ? tree : fn(tree)
  }
  if (tree.type === 'leaf') return tree
  const [head, ...rest] = path
  const children: [LayoutNode, LayoutNode] = [...tree.children]
  children[head] = mapAtPath(children[head], rest, fn)
  return { ...tree, children }
}

/** Set the ratio at the internal node addressed by `path`, clamped to
 *  [0.05, 0.95]. No-op when the path does not address an internal node. */
export function setRatio(tree: LayoutNode, path: (0 | 1)[], ratio: number): LayoutNode {
  return mapAtPath(tree, path, (node) => ({ ...node, ratio: clampRatio(ratio) }))
}

/** Toggle 'row' <-> 'column' at the internal node addressed by `path`. */
export function changeDirection(tree: LayoutNode, path: (0 | 1)[]): LayoutNode {
  return mapAtPath(tree, path, (node) => ({
    ...node,
    type: node.type === 'row' ? 'column' : 'row'
  }))
}

/** Swap the two children of the internal node addressed by `path`. */
export function swapPanes(tree: LayoutNode, path: (0 | 1)[]): LayoutNode {
  return mapAtPath(tree, path, (node) => ({
    ...node,
    children: [node.children[1], node.children[0]]
  }))
}

/** All leaf sessionIds in left-to-right document order. */
export function collectSessionIds(tree: LayoutNode): string[] {
  if (tree.type === 'leaf') return [tree.sessionId]
  return [...collectSessionIds(tree.children[0]), ...collectSessionIds(tree.children[1])]
}

/** First leaf with the given sessionId, or null. */
export function findLeaf(tree: LayoutNode, sessionId: string): LayoutLeaf | null {
  if (tree.type === 'leaf') return tree.sessionId === sessionId ? tree : null
  return findLeaf(tree.children[0], sessionId) ?? findLeaf(tree.children[1], sessionId)
}

function clampRatios(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return node
  return {
    ...node,
    ratio: clampRatio(node.ratio),
    children: [clampRatios(node.children[0]), clampRatios(node.children[1])]
  }
}

/** Remove later duplicate occurrences of a sessionId; siblings absorb the
 *  freed slot. `seen` threads through the traversal in document order so the
 *  FIRST occurrence is the one kept. Returns null for a fully-dropped subtree. */
function dedupeKeepFirst(node: LayoutNode, seen: Set<string>): LayoutNode | null {
  if (node.type === 'leaf') {
    if (seen.has(node.sessionId)) return null
    seen.add(node.sessionId)
    return node
  }
  const left = dedupeKeepFirst(node.children[0], seen)
  const right = dedupeKeepFirst(node.children[1], seen)
  if (left === null) return right
  if (right === null) return left
  return { ...node, children: [left, right] }
}

/**
 * Read-path normalization (council invariants, enforced at the serialization
 * boundary, not trusted on deserialization): clamp every ratio into
 * [0.05, 0.95] and drop duplicate sessionIds keep-first. A valid tree always
 * keeps at least its first leaf, so the result is never null.
 */
export function normalizeTree(tree: LayoutNode): LayoutNode {
  const clamped = clampRatios(tree)
  return dedupeKeepFirst(clamped, new Set()) ?? clamped
}

/**
 * Convert the pre-1-2 persisted shape — a flat `[{slot, agent}]` array — into
 * a versioned tree. Leaves are built in slot order via `resolveSessionId`
 * (storage resolves or creates the stable sessions-row id per agent), then
 * assembled into a balanced binary tree: for N leaves each internal node's
 * ratio is its left leaf count / total leaf count, so all panes are equal
 * size. Phase 1 only ever has 2 leaves -> a single row split at ratio 0.5.
 * Duplicate agents collapse keep-first. Throws on an empty input.
 */
export function convertLegacyFlatLayout(
  flat: { slot: number; agent: string }[],
  resolveSessionId: (agent: string, slot: number) => string
): LayoutJson {
  const sorted = [...flat].sort((a, b) => a.slot - b.slot)
  const seenAgents = new Set<string>()
  const leaves: LayoutLeaf[] = []
  for (const entry of sorted) {
    if (seenAgents.has(entry.agent)) continue
    seenAgents.add(entry.agent)
    leaves.push(createLeaf(resolveSessionId(entry.agent, entry.slot)))
  }
  if (leaves.length === 0) {
    throw new Error('convertLegacyFlatLayout: no panes to convert')
  }
  return { version: 1, root: buildBalanced(leaves) }
}

function buildBalanced(leaves: LayoutLeaf[]): LayoutNode {
  if (leaves.length === 1) return leaves[0]
  const leftCount = Math.ceil(leaves.length / 2)
  return {
    type: 'row',
    ratio: clampRatio(leftCount / leaves.length),
    children: [buildBalanced(leaves.slice(0, leftCount)), buildBalanced(leaves.slice(leftCount))]
  }
}
