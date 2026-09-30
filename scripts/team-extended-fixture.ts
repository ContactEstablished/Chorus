import fs from 'node:fs'
import path from 'node:path'
import { createLongFixture } from './team-long-fixture'

/** Larger independent acceptance contract; implementations remain empty until a measured run. */
export function createExtendedFixture(root: string) {
  const base = createLongFixture(root)
  const additions = [
    ['expression.cjs', 'relational.cjs', 'joins.cjs', 'window.cjs', 'patch.cjs', 'pipeline.cjs'],
    ['heap.cjs', 'planning.cjs', 'retry.cjs', 'simulator.cjs', 'checkpoints.cjs', 'engine.cjs']
  ]
  const groups = base.groups.map((g, i) => [...g, ...additions[i]]), files = groups.flat()
  const specPath = path.join(root, 'SPEC.md')
  const original = fs.readFileSync(specPath, 'utf8').replace('in eight CommonJS files', 'in twenty CommonJS files').replace('Only the eight listed .cjs files are editable.', 'Only the twenty implementation .cjs files assigned by the task are editable.').replace('SPEC.md, acceptance.test.cjs, check.mjs', 'SPEC.md, acceptance.test.cjs, acceptance-extended.test.cjs, check.mjs')
  fs.writeFileSync(specPath, original + extendedSpec)
  for (const file of additions.flat()) fs.writeFileSync(path.join(root, file), 'module.exports={};\n')
  fs.writeFileSync(path.join(root, 'acceptance-extended.test.cjs'), extendedAcceptance)
  fs.writeFileSync(path.join(root, 'check.mjs'), `import{execFileSync}from'node:child_process';for(const file of ${JSON.stringify(files)})execFileSync(process.execPath,['--check',file],{stdio:'inherit'});\n`)
  return { ...base, files, groups, references: ['SPEC.md', 'acceptance.test.cjs', 'acceptance-extended.test.cjs'], frozen: [...base.frozen, 'acceptance-extended.test.cjs'],
    goal: 'Implement the complete twenty-module offline data-query library and deterministic job engine described in committed SPEC.md. The CSV/data subsystem owns ' + groups[0].join(', ') + '; the job subsystem owns ' + groups[1].join(', ') + '. All contracts and independent acceptance tests must pass. Only these twenty .cjs implementation files are editable. Keep specifications, acceptance tests, package files and check.mjs unchanged. No dependencies, network or filesystem IO in implementations, native/nested agents, unrelated edits or pushes. Read the specification and both acceptance files. Do not special-case tests.' }
}

const extendedSpec = `

EXTENDED DATA SUBSYSTEM (same ownership as the four CSV modules)
All new functions validate inputs, throw Error on invalid input and do not mutate inputs. Record fields
including __proto__ and constructor are ordinary own data properties, never prototype assignment.
Rows are plain JSON objects; deep-fresh outputs may not share nested objects with inputs. Reject cycles,
undefined, nonfinite numbers and functions in JSON inputs. JSON equality ignores object key order.

expression.cjs exports tokenize(text), parseExpression(text), evaluateExpression(textOrAst,row).
Implement an interpreter, never eval/Function. tokenize returns [{type,value,start,end},...] including
{type:'eof',value:null,start:text.length,end:text.length}. Types: number,string,identifier,operator,eof.
Positions count UTF-16 characters; skip whitespace. Numbers use decimal forms including .5, 1., exponents;
signs are unary operators, not part of number tokens. Strings are double-quoted JSON strings with JSON
escapes. Keywords true/false/null are identifier tokens; identifier names use ASCII letters/underscore,
then letters/digits/underscore, with dots as a separate operator. Reject overflow numbers, unknown
characters, malformed strings and unsupported operators. Operator tokens use their spelling as value.
AST forms are exactly {type:'literal',value}, {type:'field',path:[names]}, {type:'unary',op,arg},
{type:'binary',op,left,right}, {type:'conditional',condition,yes,no}, {type:'call',name,args:[ASTs]}.
Lowest to highest precedence: ?: (right associative), ??, ||, &&, ==/!=, </<=/>/>=, +/- , */% , unary !/-.
Binary operators are left associative. Parentheses group. Functions: lower/upper(string), length(string
or array), abs(number), coalesce(one or more values). Unknown functions and invalid arity throw even in
an unexecuted branch; empty expression and trailing tokens throw. Dotted fields inspect own properties
only; missing/null intermediates yield null. Row must be a plain JSON object. Arithmetic needs finite
numbers and a finite result; division/modulo by zero throw. + is numeric only. Ordering accepts two
numbers or two strings of the same type; equality is strict scalar equality (0 equals -0). Logical
operators return booleans and short-circuit using JS truthiness; ! coerces to boolean. ?? and coalesce
return the first nonnull value (false/0/empty string are preserved); coalesce short-circuits evaluation.
Conditional evaluates only its selected branch. Evaluation accepts a parsed AST; reject malformed ASTs
and unsupported fields/operators rather than executing arbitrary structure. Returned objects/arrays
are fresh copies. No mutation of text, AST or row.

relational.cjs exports groupRows(rows,keys,aggregates). keys is an array of unique nonempty field names.
aggregates is [{as,op,column?}], aliases unique and disjoint from keys. Ops count,sum,avg,min,max,first,
last,collect. count counts rows and needs no column; other ops require a nonempty column. Groups appear
in first-seen order, use scalar key tuples with type identity, and missing keys become null. Non-scalar
keys throw. Results contain key fields then aggregate aliases. Numeric ops ignore null/missing but reject
other nonnumeric values. sum of no numbers is 0; avg/min/max of no numbers is null. first/last include
null and copy arbitrary JSON values; collect includes every row's value, missing becomes null. Empty rows
with keys=[] yields one aggregate row (count 0, sum 0, others null, collect []); with nonempty keys yields [].

joins.cjs exports joinRows(left,right,{on,type='inner',suffixes=['_left','_right']}). on is a nonempty array
of unique {left,right} field pairs. type: inner,left,right,full. Scalar tuple keys match only equal types
and values; a missing/null component never matches. Each matching pair emits a row, including duplicate
key Cartesian products, in left input order then right input order. For left/full include unmatched left
at its input position; for right/full append unmatched right in right input order after matched rows.
Output columns use the first-seen union of left keys followed by right keys. Every name present on both
sides gets each side's suffix, even join key fields; unmatched side columns are null. Reject non-scalar
join keys, invalid options, equal/empty suffixes or suffixes producing output name collisions. Deep copies.

window.cjs exports windowRows(rows,{partitionBy=[],orderBy,functions}). Partition fields are unique names
with scalar tuple keys, missing=null. orderBy is {column,direction:'asc'|'desc'}; direction defaults asc.
Order values are finite numbers or null/missing; null sorts last in both directions. Ties preserve input
order. functions: [{as,op,column?,size?}], unique fresh aliases (may not overwrite any input field). Ops:
rowNumber,rank,denseRank,runningSum,movingAverage. Numeric ops require column; movingAverage requires
positive safe integer size. All numeric values are finite numbers or null/missing; null ignored.
Running sum begins at 0; moving average uses the last size rows INCLUDING current and is null if no
numeric values in that window. rank ties share the first position (1,1,3), denseRank (1,1,2).
Compute in partition order but return rows in original input order with aliases appended; deep copies.

patch.cjs exports applyPatch(document,operations). Implement atomic JSON Patch add/remove/replace/move/
copy/test with RFC6901 pointer escapes ~0 and ~1; invalid escapes throw. Empty pointer selects root.
Object tokens are literal own keys. Array indexes are canonical nonnegative integers (no leading zeros);
'-' is allowed only for array add; add index may equal length, other accesses must exist. add overwrites
an object property; replace/remove require existing targets. Removing root returns null; add/replace
root return a copy of value. move resolves/removes source before adding at destination; reject moving
into a descendant, allow an existing path moved to itself. copy deep-copies. test uses JSON structural
equality ignoring object key order, and failure throws Error. All parents must exist. Validate operation
fields/types; reject unknown ops. Validate and copy all JSON inputs before work; any failure leaves all
inputs untouched. Prototype-named keys must never alter Object.prototype or an output prototype.

pipeline.cjs exports executeQuery(rows,plan={}), queryCsv(chunks,options). Plan supports join (options of
joinRows plus rows), where (expression string), group {keys,aggregates}, window (windowRows options),
select [{as,expression}] (unique aliases), orderBy [{column,direction='asc'}], offset=0, limit optional.
Reject unknown plan fields and invalid options even for empty input. Operator order: join,where,group,
window,select,orderBy,slice. where uses boolean coercion; select evaluates each expression against the
same pre-projection row. Sorting is stable; order values are finite numbers or strings or null/missing,
null always last, same column's nonnull values must have the same type. offset/limit are nonnegative safe
integers. queryCsv uses importCsv once with its schema/delimiter/unknown/limits, then executeQuery with
options.plan; returns {headers,errors,sourceCount,rows}, with sourceCount counting valid imported records.
Options and results never share nested mutable objects. Validate plan before consuming chunks.

EXTENDED JOB SUBSYSTEM (same ownership as graph/schedule/state/journal)
heap.cjs exports createPriorityQueue(compare=(a,b)=>a-b). Indexed stable min-heap, not full-array sorting.
Unique nonempty string keys. API: push(key,value) returns undefined; update(key,value) requires existing
key, keeps original insertion ordinal; remove(key) returns value or undefined; peek()/pop() return
{key,value} or null; size is a getter. Comparator must be a function returning finite number when used;
ties use original insertion order. pop/remove then a new push gets a new ordinal. Queue owns its nodes,
but returned values may retain caller identity. Operations are O(log n), peek/size O(1); maintain index
through swaps. Invalid/duplicate keys throw without mutation. Never mutate value objects.

planning.cjs exports criticalPaths(graph), returning {order,duration,critical,jobs}. Revalidate graph
from graph.jobs using createGraph. order is topological IDs. jobs has own ID properties containing
earliestStart,earliestFinish,latestStart,latestFinish,slack. Earliest start is max dependency finish;
duration is max finish. Sink latest finish is project duration; other latest finish is min successor
latest start. critical contains zero-slack IDs in topological order. Empty graph gives duration0/empty.
Use declared durations, ignore resource constraints; no graph mutation; safe prototype names.

retry.cjs exports retryDelay(attempt,options={}). attempt positive safe integer; options base=1,max=60000,
multiplier=2,jitter=0,seed=1. base/max finite nonnegative; multiplier finite >=1; jitter in [0,1]; seed a
uint32 integer. Reject unknown fields. Base delay min(max,base*multiplier^(attempt-1)); overflow saturates
to max (zero base stays zero). For jitter, initial uint32 is seed or 0x9e3779b9 for seed0. Apply xorshift32
(x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0) attempt times; unit=x/2^32. Return Math.round(min(max,baseDelay*
(1-jitter+2*jitter*unit))). Pure deterministic; bound extremely large attempts by jumping or reject
attempt>1000000 with Error (do not loop billions of times). Inputs unchanged.

simulator.cjs exports simulate(graph,options={}). slots=1; capacities={}; failures={} (own ID=>nonnegative
safe integer number of first attempts to fail); retry={} (retryDelay options); maxEvents=100000 positive
safe integer. Reject unknown fields and unknown failure IDs. Start at time0 and createState; schedule
uses existing priority/resource policy. Finish time=start+declared duration. At equal time settle all
running finishes in original job input order BEFORE scheduling more. Failure transitions fail, then
retry at finish+retryDelay(current attempts,retry) if attempts<maxAttempts. Until retry time keep failed
state and reserve no slot; at due time transition retry before scheduling. A job exhausting attempts is
terminal failed; cancel pending downstream jobs with an exhausted/cancelled dependency transitively
using normal cancel transitions at the current time. No cancellation while an ancestor can retry.
Zero-duration jobs settle at the same time without advancing clock; ensure progress. If pending work
has no running finish or future retry and cannot schedule, throw Error (resource deadlock). Guard event
count and finite safe time overflow. Return {state,makespan,starts,ends}; starts [{id,attempt,at}], ends
[{id,attempt,at,status:'succeeded'|'failed'}]. State uses the existing transition API/seq journal and is
replayable. makespan final time (empty graph0). Everything fresh; no IO/timers or graph/options mutation.

checkpoints.cjs exports createCheckpoint(graph,state), loadCheckpoint(graph,checkpoint). Use native
crypto SHA256 over canonical JSON (recursively sort object keys, preserve array order). Envelope exactly
{version:1,graphHash,events,state:{version,jobs},hash}. graphHash hashes graph; hash hashes the envelope
WITHOUT hash. create must replay state.events with journal.replay and verify version/jobs equal claimed
state, then deep-copy. load checks exact envelope fields, both hashes and sequences, replays events and
verifies claimed state before returning full fresh replayed state. Reject forged/reordered events,
changed graph, impossible transitions, unknown extra envelope fields and invalid JSON values. No mutation.

engine.cjs exports createEngine(graph,options={}). Revalidate graph and copy it; options only checkpoint
(optional). State starts empty or loads checkpoint. API getState() returns a deep fresh copy; ready
({now,slots,capacities}) returns schedule result; dispatch({now,slots,capacities}) selects ready IDs and
atomically applies their start events at now, returning those IDs; apply(event) atomically transitions
and returns a fresh state; checkpoint() returns createCheckpoint; restore(checkpoint) replaces state
only after valid load and returns a fresh state; plan() returns criticalPaths; run(options) calls simulate
from scratch and atomically replaces engine state only on success, returning a deep fresh simulation
result. Failed dispatch/apply/restore/run leaves current state unchanged. No externally mutable internal
state; previous returned views and caller graph cannot change later operations. No hidden native agents.
`

const extendedAcceptance = String.raw`const{test}=require('node:test');const a=require('node:assert/strict');
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
const copy=x=>JSON.parse(JSON.stringify(x));
const expr=require('./expression.cjs'), rel=require('./relational.cjs'), join=require('./joins.cjs'), win=require('./window.cjs'), patch=require('./patch.cjs'), query=require('./pipeline.cjs');
const heap=require('./heap.cjs'), plan=require('./planning.cjs'), retry=require('./retry.cjs'), sim=require('./simulator.cjs'), cp=require('./checkpoints.cjs'), engine=require('./engine.cjs');
const graph=jobs=>require('./graph.cjs').createGraph(jobs);
const cases=[['2+3*4',{},14],['(2+3)*4',{},20],['10-3-2',{},5],['2e2 / .5',{},400],['-2*-3',{},6],['!false',{},true],['1==1',{},true],['1=="1"',{},false],['4!=5',{},true],['3<=3',{},true],['"b">"a"',{},true],['false && (1/0)',{},false],['true || (1/0)',{},true],['null ?? 7',{},7],['0 ?? 7',{},0],['false ? 1/0 : 3',{},3],['true ? false ? 1 : 2 : 3',{},2],['upper(lower("HeLLo"))',{},'HELLO'],['length("abc")',{},3],['abs(-8)',{},8],['coalesce(null,0,1/0)',{},0],['nested.value+1',{nested:{value:4}},5],['missing.deep ?? 9',{},9],['true && "x"',{},true],['"" || 0',{},false],['3%2',{},1],['a ?? b ?? 3',{a:null,b:2},2]];
for(const [text,row,value]of cases)test('expression '+text,()=>{const input=freeze(copy(row));const ast=expr.parseExpression(text);a.equal(expr.evaluateExpression(text,input),value);a.equal(expr.evaluateExpression(freeze(ast),input),value)});
test('token source positions and JSON escape',()=>a.deepEqual(expr.tokenize(' 1 + "a\\nb"'),[{type:'number',value:1,start:1,end:2},{type:'operator',value:'+',start:3,end:4},{type:'string',value:'a\nb',start:5,end:11},{type:'eof',value:null,start:11,end:11}]));
test('exact AST precedence',()=>a.deepEqual(expr.parseExpression('a+2*3'),{type:'binary',op:'+',left:{type:'field',path:['a']},right:{type:'binary',op:'*',left:{type:'literal',value:2},right:{type:'literal',value:3}}}));
for(const text of ['', '1 2','1 +','"bad','1e999','a[0]','1===1','unknown(1)','abs(1,2)','true ? 1','(1+2','1 / 0','1 % 0','1+"2"','"a" < 2','length(2)','abs("2")'])test('expression rejects '+text,()=>a.throws(()=>expr.evaluateExpression(text,{}),Error));
test('expression own properties only',()=>{const row=JSON.parse('{"__proto__":{"n":4},"constructor":2}');a.equal(expr.evaluateExpression('__proto__.n+constructor',row),6);a.equal(expr.evaluateExpression('toString',{}),null);a.equal({}.n,undefined)});
test('expression rejects forged AST',()=>a.throws(()=>expr.evaluateExpression({type:'binary',op:'evil',left:{type:'literal',value:1},right:{type:'literal',value:2}},{}),Error));
test('group numbers nulls order and copies',()=>{const rows=freeze([{k:'b',v:2,x:{n:1}},{k:'a',v:null,x:{n:2}},{k:'b',v:4,x:{n:3}}]);const result=rel.groupRows(rows,['k'],[{as:'n',op:'count'},{as:'sum',op:'sum',column:'v'},{as:'avg',op:'avg',column:'v'},{as:'min',op:'min',column:'v'},{as:'max',op:'max',column:'v'},{as:'first',op:'first',column:'x'},{as:'last',op:'last',column:'x'},{as:'all',op:'collect',column:'v'}]);a.deepEqual(result,[{k:'b',n:2,sum:6,avg:3,min:2,max:4,first:{n:1},last:{n:3},all:[2,4]},{k:'a',n:1,sum:0,avg:null,min:null,max:null,first:{n:2},last:{n:2},all:[null]}]);a.notEqual(result[0].first,rows[0].x)});
test('global empty aggregation',()=>{a.deepEqual(rel.groupRows([],[],[{as:'n',op:'count'},{as:'sum',op:'sum',column:'x'},{as:'mean',op:'avg',column:'x'},{as:'list',op:'collect',column:'x'}]),[{n:0,sum:0,mean:null,list:[]}]);a.deepEqual(rel.groupRows([],['x'],[{as:'n',op:'count'}]),[])});
test('group keys have scalar type identity',()=>a.deepEqual(rel.groupRows([{k:1},{k:'1'},{k:null},{},{k:false},{k:0}],['k'],[{as:'n',op:'count'}]),[{k:1,n:1},{k:'1',n:1},{k:null,n:2},{k:false,n:1},{k:0,n:1}]));
test('group prototype names safe',()=>{const rows=[JSON.parse('{"__proto__":"x","constructor":3}')];a.deepEqual(rel.groupRows(rows,['__proto__'],[{as:'constructor',op:'sum',column:'constructor'}]),JSON.parse('[{"__proto__":"x","constructor":3}]'));a.equal({}.polluted,undefined)});
for(const [rows,keys,aggs]of [[[],['x','x'],[]],[[],['x'],[{as:'x',op:'count'}]],[[],[],[{as:'n',op:'bad'}]],[[{x:'bad'}],[],[{as:'n',op:'sum',column:'x'}]],[[{k:{}}],['k'],[]]])test('group invalid '+JSON.stringify([rows,keys,aggs]),()=>a.throws(()=>rel.groupRows(rows,keys,aggs),Error));
test('join duplicate products and unmatched full order',()=>{const left=freeze([{k:1,l:{n:1}},{k:1,l:{n:2}},{k:2,l:{n:3}}]),right=freeze([{k:1,r:'a'},{k:1,r:'b'},{k:3,r:'c'}]);const out=join.joinRows(left,right,{on:[{left:'k',right:'k'}],type:'full'});a.deepEqual(out.map(x=>[x.k_left,x.k_right,x.r]),[[1,1,'a'],[1,1,'b'],[1,1,'a'],[1,1,'b'],[2,null,null],[null,3,'c']]);a.notEqual(out[0].l,left[0].l);a.deepEqual(Object.keys(out[0]),['k_left','l','k_right','r'])});
for(const type of ['inner','left','right','full'])test('join '+type+' null/type keys',()=>{const out=join.joinRows([{k:null,l:1},{k:'1',l:2},{k:1,l:3}],[{k:null,r:1},{k:1,r:2}],{on:[{left:'k',right:'k'}],type});a.equal(out.length,{inner:1,left:3,right:2,full:4}[type]);a.equal(out.filter(x=>x.k_left===1&&x.k_right===1).length,1)});
test('join composite keys',()=>a.equal(join.joinRows([{a:1,b:'x'},{a:1,b:'y'}],[{c:1,d:'y'}],{on:[{left:'a',right:'c'},{left:'b',right:'d'}]}).length,1));
for(const options of [{on:[]},{on:[{left:'k',right:'k'}],type:'bad'},{on:[{left:'k',right:'k'}],suffixes:['x','x']}])test('join invalid '+JSON.stringify(options),()=>a.throws(()=>join.joinRows([{k:1}],[{k:1}],options),Error));
test('join generated suffix collision',()=>a.throws(()=>join.joinRows([{k:1,k_left:2}],[{k:1}],{on:[{left:'k',right:'k'}]}),Error));
test('window tie ranks original order and moving rows',()=>{const rows=freeze([{id:'a',p:'x',o:2,v:3},{id:'b',p:'x',o:1,v:2},{id:'c',p:'x',o:1,v:null},{id:'d',p:'y',o:null,v:8}]);const out=win.windowRows(rows,{partitionBy:['p'],orderBy:{column:'o'},functions:[{as:'n',op:'rowNumber'},{as:'r',op:'rank'},{as:'d',op:'denseRank'},{as:'s',op:'runningSum',column:'v'},{as:'m',op:'movingAverage',column:'v',size:2}]});a.deepEqual(out.map(x=>[x.id,x.n,x.r,x.d,x.s,x.m]),[['a',3,3,2,5,3],['b',1,1,1,2,2],['c',2,1,1,2,2],['d',1,1,1,8,8]])});
test('window descending nulls last',()=>a.deepEqual(win.windowRows([{o:null},{o:1},{o:2}],{orderBy:{column:'o',direction:'desc'},functions:[{as:'n',op:'rowNumber'}]}).map(x=>x.n),[3,2,1]));
test('window nested copies',()=>{const input=freeze([{o:1,child:{n:2}}]);const result=win.windowRows(input,{orderBy:{column:'o'},functions:[{as:'n',op:'rank'}]});a.notEqual(result[0].child,input[0].child)});
for(const functions of [[{as:'o',op:'rank'}],[{as:'n',op:'bad'}],[{as:'n',op:'movingAverage',column:'o',size:0}]])test('window invalid '+JSON.stringify(functions),()=>a.throws(()=>win.windowRows([{o:1}],{orderBy:{column:'o'},functions}),Error));
test('patch operations array moves and deep copies',()=>{const input=freeze({a:[{n:1},{n:2}],b:{x:3}});const result=patch.applyPatch(input,[{op:'copy',from:'/a/0',path:'/copy'},{op:'move',from:'/a/0',path:'/a/1'},{op:'replace',path:'/b/x',value:4},{op:'add',path:'/a/-',value:{n:3}},{op:'test',path:'/copy',value:{n:1}},{op:'remove',path:'/b/x'}]);a.deepEqual(result,{a:[{n:2},{n:1},{n:3}],b:{},copy:{n:1}});a.notEqual(result.copy,input.a[0]);a.notEqual(result.a[0],input.a[1])});
test('patch pointer escapes and prototype keys',()=>{const result=patch.applyPatch({},[{op:'add',path:'/a~1b',value:{'~x':1}},{op:'replace',path:'/a~1b/~0x',value:2},{op:'add',path:'/__proto__',value:{polluted:true}},{op:'add',path:'/constructor',value:4}]);a.equal(result['a/b']['~x'],2);a.equal(Object.getPrototypeOf(result),Object.prototype);a.equal(Object.hasOwn(result,'__proto__'),true);a.equal({}.polluted,undefined)});
test('patch root and equality ignore key order',()=>{a.deepEqual(patch.applyPatch({x:1},[{op:'replace',path:'',value:[1,2]}]),[1,2]);a.equal(patch.applyPatch({},[{op:'remove',path:''}]),null);a.deepEqual(patch.applyPatch({a:1,b:2},[{op:'test',path:'',value:{b:2,a:1}}]),{a:1,b:2})});
test('patch same path and prefix sibling',()=>{a.deepEqual(patch.applyPatch({a:1},[{op:'move',from:'/a',path:'/a'}]),{a:1});a.deepEqual(patch.applyPatch({a:1},[{op:'move',from:'/a',path:'/ab'}]),{ab:1})});
for(const op of [{op:'test',path:'/a',value:2},{op:'remove',path:'/missing'},{op:'add',path:'/a/01',value:3},{op:'replace',path:'/a/-',value:3},{op:'add',path:'/missing/x',value:1},{op:'move',from:'/a',path:'/a/0/x'},{op:'add',path:'/bad~2',value:1},{op:'evil',path:''}])test('patch atomic rejection '+JSON.stringify(op),()=>{const input=freeze({a:[1,2]});a.throws(()=>patch.applyPatch(input,[{op:'add',path:'/new',value:1},op]),Error);a.deepEqual(input,{a:[1,2]})});
test('query filter projection sort pagination',()=>{const rows=freeze([{id:1,x:2},{id:2,x:4},{id:3,x:3}]);a.deepEqual(query.executeQuery(rows,{where:'x>=3',select:[{as:'name',expression:'"row"'},{as:'value',expression:'x*2'}],orderBy:[{column:'value',direction:'desc'}],offset:1,limit:1}),[{name:'row',value:6}])});
test('query composition join group window select',()=>{const result=query.executeQuery([{k:1,v:2},{k:1,v:3},{k:2,v:4}],{join:{rows:[{key:1,name:'a'},{key:2,name:'b'}],on:[{left:'k',right:'key'}]},where:'v>=2',group:{keys:['name'],aggregates:[{as:'total',op:'sum',column:'v'}]},window:{orderBy:{column:'total',direction:'desc'},functions:[{as:'rank',op:'rowNumber'}]},select:[{as:'name',expression:'upper(name)'},{as:'total',expression:'total'},{as:'rank',expression:'rank'}]});a.deepEqual(result,[{name:'A',total:5,rank:1},{name:'B',total:4,rank:2}])});
test('query CSV consumes once and reports normalization errors',()=>{let passes=0;const chunks={*[Symbol.iterator](){a.equal(++passes,1);yield 'id,v\n1,2\n2,bad\n3,4\n'}};const out=query.queryCsv(chunks,{schema:[{name:'id',type:'number'},{name:'v',type:'number'}],plan:{where:'v>2',select:[{as:'answer',expression:'id+v'}]}});a.deepEqual(out,{headers:['id','v'],errors:[{row:2,column:'v',code:'number'}],sourceCount:2,rows:[{answer:7}]})});
test('query validates before consuming',()=>{let consumed=false;const chunks={*[Symbol.iterator](){consumed=true;yield ''}};a.throws(()=>query.queryCsv(chunks,{schema:[],plan:{offset:-1}}),Error);a.equal(consumed,false)});
for(const p of [{unknown:1},{offset:-1},{limit:1.5},{select:[{as:'x',expression:'1'},{as:'x',expression:'2'}]},{where:'1+'},{orderBy:[{column:'x',direction:'bad'}]}])test('query empty invalid '+JSON.stringify(p),()=>a.throws(()=>query.executeQuery([],p),Error));
test('heap stable updates and removals',()=>{const q=heap.createPriorityQueue((x,y)=>x.p-y.p);q.push('a',{p:2});q.push('b',{p:2});q.push('c',{p:1});a.equal(q.size,3);a.equal(q.peek().key,'c');q.update('a',{p:0});a.equal(q.pop().key,'a');a.deepEqual(q.remove('c'),{p:1});a.equal(q.remove('missing'),undefined);a.equal(q.pop().key,'b');a.equal(q.pop(),null);a.equal(q.peek(),null);a.equal(q.size,0)});
test('heap preserves ordinal through update but resets after remove',()=>{const q=heap.createPriorityQueue();q.push('a',1);q.push('b',1);q.update('a',1);a.equal(q.pop().key,'a');q.push('a',1);a.equal(q.pop().key,'b');a.equal(q.pop().key,'a')});
test('heap comparator budget and index correctness',()=>{let comparisons=0;const q=heap.createPriorityQueue((x,y)=>{comparisons++;return x-y});const values=Array.from({length:1024},(_,i)=>(i*73)%1024);values.forEach((v,i)=>q.push('k'+i,v));for(let i=0;i<300;i++)q.update('k'+i,-i);for(let i=500;i<700;i++)q.remove('k'+i);const result=[];while(q.size)result.push(q.pop().value);const expected=values.map((v,i)=>({v:i<300?-i:v,i})).filter(x=>x.i<500||x.i>=700).sort((x,y)=>x.v-y.v||x.i-y.i).map(x=>x.v);a.deepEqual(result,expected);a.ok(comparisons<60000,'Indexed heap must avoid sorting entire queue per operation')});
test('heap invalid operations leave nodes unchanged',()=>{const q=heap.createPriorityQueue();q.push('a',1);a.throws(()=>q.push('a',2),Error);a.throws(()=>q.update('missing',2),Error);a.throws(()=>q.push('',2),Error);a.equal(q.size,1);a.deepEqual(q.pop(),{key:'a',value:1})});
test('critical path slack and empty graphs',()=>{const g=freeze(graph([{id:'a',duration:2},{id:'b',deps:['a'],duration:5},{id:'c',deps:['a'],duration:1},{id:'d',deps:['b','c'],duration:2}]));const out=plan.criticalPaths(g);a.equal(out.duration,9);a.deepEqual(out.order,['a','b','c','d']);a.deepEqual(out.critical,['a','b','d']);a.deepEqual(out.jobs.c,{earliestStart:2,earliestFinish:3,latestStart:6,latestFinish:7,slack:4});a.deepEqual(plan.criticalPaths(graph([])),{order:[],duration:0,critical:[],jobs:{}})});
test('critical path disconnected/prototype jobs',()=>{const out=plan.criticalPaths(graph([{id:'__proto__',duration:3},{id:'constructor',duration:1}]));a.equal(out.jobs.constructor.slack,2);a.equal(out.jobs.__proto__.slack,0);a.equal({}.slack,undefined)});
for(const [attempt,options,expected]of [[1,{},1],[4,{},8],[20,{max:9},9],[3,{base:2,multiplier:3,max:100},18],[2,{base:0},0]])test('retry '+JSON.stringify([attempt,options]),()=>a.equal(retry.retryDelay(attempt,options),expected));
test('retry deterministic exact xorshift and cap',()=>{const options=freeze({base:100,max:1000,jitter:.5,seed:123});let x=123;for(let i=1;i<=8;i++){x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;const expected=Math.round(Math.min(1000,Math.min(1000,100*2**(i-1))*(.5+x/2**32)));a.equal(retry.retryDelay(i,options),expected)}a.equal(retry.retryDelay(1000000,{base:0}),0)});
for(const [attempt,options]of [[0,{}],[1,{jitter:2}],[1,{seed:-1}],[1,{multiplier:.5}],[1,{unknown:1}],[1000001,{}]])test('retry invalid '+JSON.stringify([attempt,options]),()=>a.throws(()=>retry.retryDelay(attempt,options),Error));
test('simulation dependency concurrency and simultaneous finish',()=>{const g=freeze(graph([{id:'a',duration:2},{id:'b',duration:2},{id:'c',deps:['a','b'],duration:1}]));const out=sim.simulate(g,{slots:2});a.equal(out.makespan,3);a.deepEqual(out.starts,[{id:'a',attempt:1,at:0},{id:'b',attempt:1,at:0},{id:'c',attempt:1,at:2}]);a.deepEqual(out.ends.map(x=>[x.id,x.at]),[['a',2],['b',2],['c',3]]);a.equal(out.state.jobs.c.status,'succeeded');a.deepEqual(require('./journal.cjs').replay(g,out.state.events),out.state)});
test('simulation priority resources and retries',()=>{const g=graph([{id:'low',duration:1,priority:0,resource:'gpu'},{id:'high',duration:2,priority:5,resource:'gpu',maxAttempts:2},{id:'cpu',duration:1,resource:'cpu'},{id:'after',deps:['high'],duration:1}]);const out=sim.simulate(freeze(g),freeze({slots:2,capacities:{gpu:1,cpu:1},failures:{high:1},retry:{base:3}}));a.deepEqual(out.starts.map(x=>[x.id,x.at]),[['high',0],['cpu',0],['low',2],['high',5],['after',7]]);a.equal(out.makespan,8);a.equal(out.state.jobs.high.attempts,2)});
test('simulation exhausted failure cancels transitive dependents',()=>{const g=graph([{id:'a',maxAttempts:2},{id:'b',deps:['a']},{id:'c',deps:['b']},{id:'ok'}]);const out=sim.simulate(g,{slots:2,failures:{a:3},retry:{base:0}});a.equal(out.state.jobs.a.status,'failed');a.equal(out.state.jobs.b.status,'cancelled');a.equal(out.state.jobs.c.status,'cancelled');a.equal(out.state.jobs.ok.status,'succeeded');a.deepEqual(require('./journal.cjs').replay(g,out.state.events),out.state)});
test('simulation zero durations and empty',()=>{const out=sim.simulate(graph([{id:'a',duration:0},{id:'b',deps:['a'],duration:0}]));a.equal(out.makespan,0);a.equal(out.state.jobs.b.status,'succeeded');a.deepEqual(sim.simulate(graph([])),{state:require('./state.cjs').createState(graph([])),makespan:0,starts:[],ends:[]})});
for(const options of [{slots:0},{capacities:{default:0}},{failures:{unknown:1}},{failures:{a:-1}},{maxEvents:1},{unknown:1}])test('simulation rejects '+JSON.stringify(options),()=>a.throws(()=>sim.simulate(graph([{id:'a'}]),options),Error));
test('simulation prototype IDs/resources',()=>{const out=sim.simulate(graph([{id:'__proto__',resource:'__proto__',duration:0},{id:'constructor',deps:['__proto__'],resource:'constructor',duration:0}]),{slots:2,capacities:JSON.parse('{"__proto__":1,"constructor":1}')});a.equal(out.state.jobs.constructor.status,'succeeded');a.equal({}.status,undefined)});
test('checkpoint validates and copies',()=>{const g=freeze(graph([{id:'a',duration:0}])),state=freeze(sim.simulate(g).state),stored=cp.createCheckpoint(g,state);a.deepEqual(cp.loadCheckpoint(g,freeze(stored)),state);a.notEqual(stored.events,state.events);a.notEqual(cp.loadCheckpoint(g,stored).jobs,state.jobs);a.equal(stored.hash.length,64);a.equal(stored.graphHash.length,64)});
test('checkpoint canonical hashes ignore object key order',()=>{const g=graph([{id:'a'}]),state=require('./state.cjs').createState(g),stored=cp.createCheckpoint(g,state);const reordered={hash:stored.hash,state:{jobs:stored.state.jobs,version:stored.state.version},events:stored.events,graphHash:stored.graphHash,version:stored.version};a.deepEqual(cp.loadCheckpoint(g,reordered),state)});
for(const mutate of [x=>x.hash='0'.repeat(64),x=>x.graphHash='0'.repeat(64),x=>x.state.jobs.a.status='failed',x=>x.events[0].seq=99,x=>x.version=2,x=>x.extra=1])test('checkpoint rejects forged '+String(mutate),()=>{const g=graph([{id:'a'}]),stored=cp.createCheckpoint(g,sim.simulate(g).state);mutate(stored);a.throws(()=>cp.loadCheckpoint(g,stored),Error)});
test('checkpoint rejects a rehashed impossible state',()=>{const canonical=x=>x&&typeof x==='object'?Array.isArray(x)?x.map(canonical):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;const g=graph([{id:'a'}]),stored=cp.createCheckpoint(g,sim.simulate(g).state);stored.state.jobs.a.status='failed';const{hash,...body}=stored;stored.hash=require('node:crypto').createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');a.throws(()=>cp.loadCheckpoint(g,stored),Error)});
test('checkpoint cannot bless forged source state or different graph',()=>{const g=graph([{id:'a'}]),state=require('./state.cjs').createState(g);state.jobs.a.status='succeeded';a.throws(()=>cp.createCheckpoint(g,state),Error);const good=cp.createCheckpoint(g,require('./state.cjs').createState(g));a.throws(()=>cp.loadCheckpoint(graph([{id:'a',duration:2}]),good),Error)});
test('engine dispatch apply checkpoint restore and immutable views',()=>{const g=freeze(graph([{id:'a',duration:1},{id:'b',deps:['a'],duration:1}])),e=engine.createEngine(g),view=e.getState();view.jobs.a.status='failed';a.equal(e.getState().jobs.a.status,'pending');a.deepEqual(e.ready({now:0,slots:2}),['a']);a.deepEqual(e.dispatch({now:0,slots:2}),['a']);const running=e.getState();e.apply({type:'succeed',id:'a',at:1});a.equal(running.jobs.a.status,'running');const saved=e.checkpoint();a.deepEqual(e.dispatch({now:1,slots:2}),['b']);e.restore(freeze(saved));a.equal(e.getState().jobs.b.status,'pending');const restored=engine.createEngine(g,{checkpoint:saved});a.deepEqual(restored.getState(),e.getState());a.equal(e.plan().duration,2)});
test('engine failed operations atomic and run installs fresh results',()=>{const g=graph([{id:'a'}]),e=engine.createEngine(g),before=e.getState();for(const act of [()=>e.apply({type:'succeed',id:'a',at:0}),()=>e.dispatch({now:-1,slots:1}),()=>e.restore({}),()=>e.run({slots:0})]){a.throws(act,Error);a.deepEqual(e.getState(),before)}const out=e.run({slots:1});a.equal(e.getState().jobs.a.status,'succeeded');out.state.jobs.a.status='failed';a.equal(e.getState().jobs.a.status,'succeeded')});
test('engine validates constructor and preserves caller graph',()=>{const g=graph([{id:'a'}]),e=engine.createEngine(g);g.jobs[0].duration=99;a.equal(e.plan().duration,1);a.throws(()=>engine.createEngine(g,{unknown:1}),Error);a.throws(()=>engine.createEngine({jobs:[{id:'a',deps:['missing']}]}),Error)});
`
