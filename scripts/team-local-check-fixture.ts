import fs from 'node:fs'
import path from 'node:path'

/** A separately identified fixture condition. Frozen acceptance is unchanged:
 * helper npm test selects its owned subsystem; independent verification runs all. */
export function boundedTeamGroups(groups: string[][]): string[][] {
  if (groups.length !== 2 || groups.some(g => g.length !== 10)) throw Error('Bounded assignments require the twenty-file fixture.')
  return [0, 4, 7].flatMap((start, i) => groups.map(g => g.slice(start, [4, 7, 10][i])))
}

export function installTeamLocalChecks(root: string, fixture: { groups: string[][]; frozen: string[]; references: string[]; goal: string }, workload: string, bounded = false): void {
  const patterns = ['small', 'substantial'].includes(workload)
    ? ['^(slug|ASCII|collision)', '^(order|rank|group|larger deterministic)']
    : ['^(CSV|formatter|schema|import|expression|token source|exact AST|group|global empty aggregation|join|window|patch|query)', '^(graph|schedule|state|cancel|journal|larger DAG|heap|critical path|retry|simulation|checkpoint|engine)']
  const groups = bounded ? boundedTeamGroups(fixture.groups) : fixture.groups
  const selectedPatterns = bounded ? ['^(CSV|formatter|schema|import)', '^(graph|schedule|state|cancel|journal|larger DAG)', '^(expression|token source|exact AST|group|global empty aggregation|join)', '^(heap|critical path|retry)', '^(window|patch|query)', '^(simulation|checkpoint|engine)'] : patterns
  const runner = `const{spawnSync}=require('node:child_process');
const groups=${JSON.stringify(groups)},patterns=${JSON.stringify(selectedPatterns)},bounded=${bounded};
const raw=process.env.CHORUS_HELPER_OWNED_PATHS;
let args=['--test'];
if(raw){const owned=JSON.parse(raw);const group=groups.findIndex(g=>owned.length===g.length&&g.every(p=>owned.includes(p)));
if(group<0){const all=groups.flat();if(owned.length!==all.length||!all.every(p=>owned.includes(p)))throw Error('Local acceptance requires one complete owned subsystem or the whole fixture.');}
else {args.push('--test-name-pattern',patterns[group]);if(bounded)args.push(group<2?'acceptance.test.cjs':'acceptance-extended.test.cjs');}console.log('Helper acceptance assignment '+(group<0?'all':group));}
const r=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,CHORUS_HELPER_OWNED_PATHS:''}});process.exit(r.status===null?1:r.status);
`
  fs.writeFileSync(path.join(root, 'helper-check.cjs'), runner)
  const file = path.join(root, 'package.json'), pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  pkg.scripts.test = 'node helper-check.cjs'
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2))
  fixture.frozen.push('helper-check.cjs')
  fixture.references.push('helper-check.cjs')
  fixture.goal += ' Local helper acceptance is available through the exact command npm test: the committed runner selects the complete owned assignment using application-supplied ownership. Other assignments are excluded only in helpers. Combined acceptance still executes every original frozen test. Keep helper-check.cjs unchanged.'
}
