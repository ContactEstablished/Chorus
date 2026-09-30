import fs from 'node:fs'
import path from 'node:path'

/** Independent acceptance, written before either condition generates implementation. */
export function createLongFixture(root: string) {
  const groups = [
    ['csv.cjs', 'codec.cjs', 'schema.cjs', 'import.cjs'],
    ['graph.cjs', 'schedule.cjs', 'state.cjs', 'journal.cjs']
  ]
  const files = groups.flat()
  const spec = `Implement an offline data-import library and a dependency-aware job engine in eight CommonJS files.
These are two independent subsystems: csv.cjs/codec.cjs/schema.cjs/import.cjs, and graph.cjs/schedule.cjs/state.cjs/journal.cjs.
Implement the full contracts below, including errors and immutability. Do not special-case the tests.
No external dependencies, file/network IO, timers, native agents or nested agents in the implementation.
Only the eight listed .cjs files are editable. SPEC.md, acceptance.test.cjs, check.mjs, package.json,
package-lock.json and .gitignore are frozen. Use only npm test, npm run typecheck and npm run build.

CSV SUBSYSTEM
csv.cjs exports createCsvParser(options={}). Options: delimiter defaults to comma; maxField defaults
to 1024; maxColumns defaults to 128. delimiter must be one UTF-16 character other than quote/CR/LF.
Limits must be positive safe integers. Parser methods push(string) and finish() return arrays of
completed records (each record is an array of decoded strings). push supports arbitrary chunk boundaries,
including an empty chunk, CRLF split across chunks, doubled quotes split across chunks, and multiline fields.
Unquoted CR, LF and CRLF end records; CRLF is a single separator. Within quotes preserve CR/LF exactly.
Quotes can open only at the beginning of a field. Within quotes a doubled quote decodes to one quote.
After the closing quote only a delimiter, record separator or EOF is valid. No implicit whitespace trimming.
finish emits an unfinished final record, including a final empty field after a delimiter; a terminating
record separator does not create a spurious final row. Empty input yields zero rows; a blank line yields [''].
Unclosed quotes, quotes inside an unquoted field, invalid postquote text, field length exceeding maxField
(decoded UTF-16 length), and column count exceeding maxColumns throw Error. Errors poison the parser:
later push or finish must throw. push after successful finish and a second finish also throw.

codec.cjs exports formatCsv(rows,options={}). rows must be arrays of strings. delimiter validation matches
the parser; eol must be LF or CRLF (default LF). Quote a field iff it contains delimiter/quote/CR/LF,
and double embedded quotes. Emit a separator after every row, but [] formats to ''. Do not mutate inputs.
Rows must have at least one field (an empty row array is invalid).

schema.cjs exports normalizeRows(headers,rows,schema,options={}), returning {records,errors}.
headers are unique nonempty strings; schema is an array of unique fields {name,type,required?,default?}.
Types: string, number, boolean, date. Invalid schema/headers/options throw Error. unknown defaults to
'ignore', alternatively 'error'; under error produce {row:0,column:header,code:'unknown'} for each
header absent from schema, in header order, but still process rows. Header and field names such as
__proto__ and constructor must work without prototype pollution. Do not mutate inputs.
Every row is an array of strings; width mismatch produces one {row:N,column:'*',code:'width'} and
excludes that record. N is 1-based data-row index. For each schema field in schema order, get its
header value or '', then trim. Blank values use an own default property verbatim (default must be a
string, finite number, boolean or null), otherwise required=true produces code 'required', otherwise
null. Validate required as boolean when provided. Nonblank string stays trimmed. Number accepts only
signed decimal notation (including .5, 1., 1e2), rejects hex/Infinity/NaN/trailing garbage, and must be finite.
Boolean accepts case-insensitive true/false or 1/0. Date accepts exactly YYYY-MM-DD for a real calendar
date in years 0001..9999, including leap-year rules, and returns that string. Invalid conversion produces
code equal to type. A row with any error is excluded; report all its field errors in schema order.
Valid records are fresh ordinary objects containing every schema field, in schema order. No values
should mutate Object.prototype. Error ordering is header errors first, then data rows and fields.

import.cjs exports importCsv(chunks,options), where chunks is a single-pass synchronous iterable of
strings and options includes schema, delimiter?, unknown?, maxField?, maxColumns?. Consume it exactly
once, stream through createCsvParser, and use the first record as headers. No records means return
{headers:[],records:[],errors:[],canonicalCsv:''}. Otherwise use normalizeRows and formatCsv to return
{headers,records,errors,canonicalCsv}. Canonical CSV headers are schema field names in schema order;
valid normalized rows use String(value), with null becoming ''. Canonical output uses the chosen
delimiter and LF. Parser errors throw; conversion errors remain in the returned errors. Validate
schema/options even for empty input. Do not mutate options, headers, records, rows or schema inputs.

JOB SUBSYSTEM
graph.cjs exports createGraph(jobs). Input jobs are {id,deps?,priority?,duration?,resource?,maxAttempts?}.
IDs and resource names must be nonempty strings. IDs are unique; deps defaults to [] and must be unique
existing IDs, never self. Reject cycles, including disconnected cycles. priority defaults to 0 and must
be finite number. duration defaults to 1 and must be a nonnegative safe integer. resource defaults to
'default'; maxAttempts defaults to 1 and must be a positive safe integer. Return a fresh graph
{jobs,topological}: normalized jobs preserve original input order and contain all six properties;
topological is a dependency-first array of IDs using Kahn's algorithm, choosing the earliest original
input index whenever more than one vertex is ready. Do not mutate even deeply frozen input.

schedule.cjs exports schedule(graph,state,{now,slots,capacities={}}). now is a finite nonnegative number;
slots is a positive safe integer; each own capacity is a nonnegative safe integer. Read state.jobs
from createState/transition. Return an array of selected pending IDs, limited by global slots minus
running jobs and per-resource capacity minus running jobs of that resource. A missing resource
capacity defaults to slots. Only jobs whose every dependency succeeded may start. Sort eligible jobs
by descending priority then original input order. Resource constraints may skip an earlier job in
favor of later candidates. Count running jobs without changing or auto-expiring them; now never
implicitly changes state. Names including __proto__ and constructor must work. No input mutation.

state.cjs exports createState(graph) and transition(graph,state,event).
Initial state: {version:0,jobs:{id:{status:'pending',attempts:0,startedAt:null,endedAt:null,error:null}},events:[]}.
Jobs map must safely support prototype names. Event is {type,id,at,error?}; type is start/succeed/fail/retry/cancel,
id exists, at is finite nonnegative and cannot precede the prior event's at. Transitions are atomic,
return deep-fresh state (including unchanged job objects and historical event objects), and never mutate inputs.
start: only pending, all dependencies succeeded, attempts < maxAttempts; set running, increment attempts,
set startedAt=at, endedAt=null,error=null. succeed: only running; set succeeded and endedAt=at.
fail: only running and requires string error; set failed, endedAt=at,error=event.error.
retry: only failed and attempts < maxAttempts; set pending,startedAt=null,endedAt=null,error=null, preserve attempts.
cancel: only pending or running; set cancelled,endedAt=at,error=null, preserve attempts and startedAt.
Reject unsupported events or invalid transition with Error and leave the original untouched.
Increment version once and append a fresh event containing exactly type,id,at, optional error when supplied,
and seq equal to the new version. Extra event properties must not leak into state. No automatic downstream cancellation.

journal.cjs exports replay(graph,events), encodeState(graph,state), restoreState(graph,text), metrics(graph,state).
replay starts at createState and applies events; optional seq must equal the next version. Ignore seq when
calling transition. encodeState returns JSON text {schema:1,graphHash,version,jobs,events}; graphHash is
SHA256 of JSON.stringify(graph), using native node:crypto. restoreState parses this envelope, requires
schema/hash and correct next seq on EVERY event, rebuilds via replay and verifies version and jobs
exactly equal to rebuilt state (object key order must not matter). Reject malformed JSON, forged status,
version, graph hash, unknown IDs, impossible transitions and missing/reordered/duplicate sequences.
Never trust claimed jobs without replay. Returned state is fresh. encodeState should reject a state
whose version/jobs do not match replay of its events. Do not modify graph/state/events.
metrics returns {statuses:{pending,running,succeeded,failed,cancelled},attempts,totalRunTime,criticalPath}.
statuses counts current jobs; attempts sums current attempts. totalRunTime sums endedAt-startedAt for
current jobs having BOTH nonnull timestamps (retry clears timestamps). criticalPath is the longest
sum of declared durations along a dependency chain, independent of status; empty graph gives 0.
`;
  fs.writeFileSync(path.join(root, 'SPEC.md'), spec)
  for (const file of files) fs.writeFileSync(path.join(root, file), 'module.exports={};\n')
  fs.writeFileSync(path.join(root, 'check.mjs'), `import{execFileSync}from'node:child_process';for(const file of ${JSON.stringify(files)})execFileSync(process.execPath,['--check',file],{stdio:'inherit'});\n`)
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nout/\n')
  const pkg = { name: 'chorus-team-long-fixture', version: '1.0.0', scripts: { test: 'node --test', typecheck: 'node check.mjs', build: 'node check.mjs' } }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2))
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': { name: pkg.name, version: pkg.version } } }))
  fs.writeFileSync(path.join(root, 'acceptance.test.cjs'), acceptance)
  return { files, groups, references: ['SPEC.md', 'acceptance.test.cjs'], frozen: ['SPEC.md', 'acceptance.test.cjs', 'check.mjs', 'package.json', 'package-lock.json', '.gitignore'], goal: 'Implement the entire offline CSV import library and dependency-aware job engine specified in the committed SPEC.md. Read SPEC.md and acceptance.test.cjs first. All eight implementation modules are currently empty. Handle streaming, validation, scheduler constraints, immutable state transitions and replay-based snapshot validation. Only the eight implementation .cjs files named in SPEC.md are editable; preserve all acceptance/configuration/specification files byte-for-byte. No dependencies, native subagents, nested agents, pushes or edits outside this disposable fixture.' }
}

const acceptance = String.raw`const {test}=require('node:test');const a=require('node:assert/strict');
const csv=require('./csv.cjs'),codec=require('./codec.cjs'),schema=require('./schema.cjs'),imp=require('./import.cjs');
const graph=require('./graph.cjs'),scheduler=require('./schedule.cjs'),state=require('./state.cjs'),journal=require('./journal.cjs');
const freeze=o=>{if(o&&typeof o==='object'){for(const v of Object.values(o))freeze(v);Object.freeze(o)}return o};
function parse(chunks,options){const p=csv.createCsvParser(options);return [...chunks.flatMap(c=>p.push(c)),...p.finish()]}
const sample='id,name,note\r\n1,"Ada, L","a""b"\r\n2,Bob,"line\r\nbreak"\r\n';
test('CSV every single cut boundary',()=>{const expected=[['id','name','note'],['1','Ada, L','a"b'],['2','Bob','line\r\nbreak']];for(let i=0;i<=sample.length;i++)a.deepEqual(parse([sample.slice(0,i),sample.slice(i)]),expected)});
test('CSV single-character chunks',()=>a.deepEqual(parse([...sample]),parse([sample])));
for(const [input,expected] of [['',[]],['\n',[['']]],['a,',[['a','']]],['a\r\n',[['a']]],['a\rb\nc',[['a'],['b'],['c']]],['""',[['']]],['"a\nb",c',[['a\nb','c']]],['""""',[['"']]],['a,,b',[['a','','b']]]])test('CSV edge '+JSON.stringify(input),()=>a.deepEqual(parse([input]),expected));
for(const input of ['"unterminated','ab"c','"a"tail','"a" b'])test('CSV rejects '+JSON.stringify(input),()=>{const p=csv.createCsvParser();a.throws(()=>{p.push(input);p.finish()});a.throws(()=>p.push('x'));a.throws(()=>p.finish())});
test('CSV completed lifecycle',()=>{const p=csv.createCsvParser();p.push('a');a.deepEqual(p.finish(),[['a']]);a.throws(()=>p.finish());a.throws(()=>p.push(''))});
test('CSV validates limits',()=>{for(const options of [{delimiter:''},{delimiter:'ab'},{delimiter:'"'},{delimiter:'\n'},{maxField:0},{maxColumns:1.2}])a.throws(()=>csv.createCsvParser(options));a.throws(()=>parse(['abc'],{maxField:2}));a.deepEqual(parse(['"a""b"'],{maxField:3}),[['a"b']]);a.throws(()=>parse(['a,b'],{maxColumns:1}));a.throws(()=>parse(['a,'],{maxColumns:1}))});
test('CSV custom delimiter and CRLF quote split',()=>a.deepEqual(parse(['a;"b\r','\nc";"x"','"y"\r','\n'],{delimiter:';'}),[['a','b\r\nc','x"y']]));
test('formatter exact and immutable',()=>{const rows=freeze([['a','x,y','q"z','line\nb'],['','',' last ']]);a.equal(codec.formatCsv(rows),'a,"x,y","q""z","line\nb"\n,, last \n');a.equal(codec.formatCsv([]),'');a.equal(codec.formatCsv([['a;b','x']],{delimiter:';',eol:'\r\n'}),'"a;b";x\r\n');for(const rows of [[[]],[[1]],['x']])a.throws(()=>codec.formatCsv(rows));a.throws(()=>codec.formatCsv([['x']],{eol:'!'}))});
test('formatter/parser deterministic corpus roundtrip',()=>{let seed=719;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)%9);const chars=['a','b',',','"','\r','\n',' ',';','Ω'];const rows=Array.from({length:100},()=>Array.from({length:1+rand()%5},()=>Array.from({length:rand()%9},()=>chars[rand()]).join('')));for(const delimiter of [',',';']){const text=codec.formatCsv(freeze(rows),{delimiter});a.deepEqual(parse([...text],{delimiter}),rows)}});
const fields=freeze([{name:'id',type:'number',required:true},{name:'name',type:'string',required:true},{name:'active',type:'boolean',default:false},{name:'day',type:'date'}]);
test('schema conversions/default/header order',()=>{const result=schema.normalizeRows(freeze(['name','day','active','id']),freeze([[' Ada ','2024-02-29','TRUE','+.5'],[' Bob ','','0','1e2']]),fields);a.deepEqual(result,{records:[{id:.5,name:'Ada',active:true,day:'2024-02-29'},{id:100,name:'Bob',active:false,day:null}],errors:[]})});
test('schema all errors and row exclusion',()=>a.deepEqual(schema.normalizeRows(['id','name','active','day'],[['no','','maybe','2023-02-29'],['1'],['2','ok','false','2000-02-29']],fields),{records:[{id:2,name:'ok',active:false,day:'2000-02-29'}],errors:[{row:1,column:'id',code:'number'},{row:1,column:'name',code:'required'},{row:1,column:'active',code:'boolean'},{row:1,column:'day',code:'date'},{row:2,column:'*',code:'width'}]}));
for(const value of ['0x10','NaN','Infinity','1e999','2x'])test('schema strict number '+value,()=>a.equal(schema.normalizeRows(['id'],[[value]],[{name:'id',type:'number'}]).errors[0].code,'number'));
for(const value of ['1900-02-29','0000-01-01','2024-04-31','2024-2-01','2024-02-30'])test('schema strict date '+value,()=>a.equal(schema.normalizeRows(['day'],[[value]],[{name:'day',type:'date'}]).errors[0].code,'date'));
test('schema safe special names and unknown order',()=>{const result=schema.normalizeRows(['extra','__proto__','constructor'],[['z','p','c']],[{name:'__proto__',type:'string'},{name:'constructor',type:'string'},{name:'missing',type:'boolean',default:null}],{unknown:'error'});a.deepEqual(result.errors,[{row:0,column:'extra',code:'unknown'}]);a.equal(Object.getPrototypeOf(result.records[0]),Object.prototype);a.equal(result.records[0].__proto__,'p');a.equal(result.records[0].constructor,'c');a.equal(result.records[0].missing,null);a.equal({}.polluted,undefined)});
test('schema rejects configuration',()=>{for(const [headers,fields,options] of [[['a','a'],[],{}],[[''],[],{}],[['a'],[{name:'a',type:'mystery'}],{}],[['a'],[{name:'a',type:'string'},{name:'a',type:'number'}],{}],[['a'],[{name:'a',type:'string',default:{}}],{}],[['a'],[{name:'a',type:'string',required:'yes'}],{}],[['a'],[],{unknown:'drop'}]])a.throws(()=>schema.normalizeRows(headers,[],fields,options))});
test('import one-pass integration',()=>{let calls=0;const chunks={*[Symbol.iterator](){a.equal(++calls,1);yield 'name,id,active,day\n';yield ' Ada ,1,true,2024-02-29\n';yield 'Bad,no,false,\n';yield 'Bob,2,,\n'}};const result=imp.importCsv(chunks,freeze({schema:fields}));a.deepEqual(result.headers,['name','id','active','day']);a.deepEqual(result.records,[{id:1,name:'Ada',active:true,day:'2024-02-29'},{id:2,name:'Bob',active:false,day:null}]);a.deepEqual(result.errors,[{row:2,column:'id',code:'number'}]);a.equal(result.canonicalCsv,'id,name,active,day\n1,Ada,true,2024-02-29\n2,Bob,false,\n')});
test('import empty/header only and fatal errors',()=>{a.deepEqual(imp.importCsv([],{schema:fields}),{headers:[],records:[],errors:[],canonicalCsv:''});a.equal(imp.importCsv(['id,name\n'],{schema:fields}).canonicalCsv,'id,name,active,day\n');a.throws(()=>imp.importCsv(['"broken'],{schema:fields}));a.throws(()=>imp.importCsv([],{schema:[{name:'x',type:'bad'}]}))});
const jobs=freeze([{id:'end',deps:['a','b'],duration:3},{id:'a',priority:2,duration:4,maxAttempts:2,resource:'cpu'},{id:'b',priority:1,duration:2,resource:'io'},{id:'free',priority:3,duration:1,resource:'cpu'}]);
test('graph deterministic dependency-first order',()=>{const g=graph.createGraph(jobs);a.deepEqual(g.topological,['a','b','end','free']);a.deepEqual(g.jobs[0],{id:'end',deps:['a','b'],priority:0,duration:3,resource:'default',maxAttempts:1});a.notEqual(g.jobs,jobs);a.notEqual(g.jobs[0].deps,jobs[0].deps);a.deepEqual(graph.createGraph([]),{jobs:[],topological:[]})});
for(const input of [[{id:'a'},{id:'a'}],[{id:'a',deps:['missing']}],[{id:'a',deps:['a']}],[{id:'a',deps:['b']},{id:'b',deps:['a']}],[{id:'ok'},{id:'a',deps:['b']},{id:'b',deps:['a']}],[{id:'a',deps:['b','b']},{id:'b'}],[{id:''}],[{id:'a',duration:-1}],[{id:'a',maxAttempts:0}],[{id:'a',priority:NaN}],[{id:'a',resource:''}]])test('graph rejects '+JSON.stringify(input),()=>a.throws(()=>graph.createGraph(input)));
test('schedule priorities/resources/global limits',()=>{const g=graph.createGraph(jobs),s=freeze(state.createState(g));a.deepEqual(scheduler.schedule(g,s,{now:0,slots:2}),['free','a']);a.deepEqual(scheduler.schedule(g,s,{now:0,slots:2,capacities:{cpu:1}}),['free','b']);a.deepEqual(scheduler.schedule(g,s,{now:0,slots:3,capacities:{cpu:0,io:1}}),['b']);const running=state.transition(g,s,{type:'start',id:'a',at:0});a.deepEqual(scheduler.schedule(g,running,{now:10000,slots:2,capacities:{cpu:1}}),['b']);a.equal(running.jobs.a.status,'running');for(const options of [{now:-1,slots:1},{now:0,slots:0},{now:0,slots:2,capacities:{cpu:-1}}])a.throws(()=>scheduler.schedule(g,s,options))});
test('schedule ties and special resources',()=>{const g=graph.createGraph([{id:'__proto__',resource:'__proto__'},{id:'constructor',resource:'constructor'},{id:'last'}]),s=state.createState(g),capacities=JSON.parse('{"__proto__":0,"constructor":1}');a.deepEqual(scheduler.schedule(g,s,{now:0,slots:3,capacities}),['constructor','last']);a.equal(s.jobs.__proto__.status,'pending');a.equal(Object.getPrototypeOf(s.jobs),Object.prototype)});
test('state full lifecycle and immutability',()=>{const g=freeze(graph.createGraph(jobs)),zero=freeze(state.createState(g));let s=state.transition(g,zero,{type:'start',id:'a',at:1,extra:'discard'});a.equal(zero.version,0);a.equal(s.version,1);a.equal(s.jobs.a.attempts,1);a.equal(s.jobs.a.startedAt,1);a.notEqual(s.jobs.b,zero.jobs.b);a.deepEqual(s.events[0],{type:'start',id:'a',at:1,seq:1});s=state.transition(g,freeze(s),{type:'fail',id:'a',at:3,error:'temporary'});a.equal(s.jobs.a.error,'temporary');s=state.transition(g,freeze(s),{type:'retry',id:'a',at:4});a.deepEqual(s.jobs.a,{status:'pending',attempts:1,startedAt:null,endedAt:null,error:null});s=state.transition(g,freeze(s),{type:'start',id:'a',at:5});const prev=freeze(s);s=state.transition(g,prev,{type:'succeed',id:'a',at:8});a.equal(s.jobs.a.status,'succeeded');a.notEqual(s.events[0],prev.events[0]);a.deepEqual(scheduler.schedule(g,s,{now:9,slots:3}),['free','b']);s=state.transition(g,s,{type:'start',id:'b',at:9});s=state.transition(g,s,{type:'succeed',id:'b',at:10});a.deepEqual(scheduler.schedule(g,s,{now:10,slots:3}),['free','end'])});
test('state invalid transitions are atomic',()=>{const g=graph.createGraph(jobs),s=freeze(state.createState(g)),before=JSON.stringify(s);for(const event of [{type:'start',id:'end',at:0},{type:'succeed',id:'a',at:0},{type:'retry',id:'a',at:0},{type:'start',id:'missing',at:0},{type:'no',id:'a',at:0},{type:'start',id:'a',at:-1}])a.throws(()=>state.transition(g,s,event));a.equal(JSON.stringify(s),before);const running=freeze(state.transition(g,s,{type:'start',id:'a',at:2}));a.throws(()=>state.transition(g,running,{type:'fail',id:'a',at:3}));a.throws(()=>state.transition(g,running,{type:'succeed',id:'a',at:1}));const failure=state.transition(g,state.transition(g,state.transition(g,running,{type:'fail',id:'a',at:3,error:'x'}),{type:'retry',id:'a',at:4}),{type:'start',id:'a',at:5});a.throws(()=>state.transition(g,state.transition(g,failure,{type:'fail',id:'a',at:6,error:'x'}),{type:'retry',id:'a',at:7}))});
test('cancel pending and running without cascade',()=>{const g=graph.createGraph(jobs);let s=state.transition(g,state.createState(g),{type:'cancel',id:'a',at:1});a.equal(s.jobs.a.endedAt,1);a.equal(s.jobs.a.startedAt,null);a.equal(s.jobs.end.status,'pending');s=state.transition(g,s,{type:'start',id:'b',at:2});s=state.transition(g,s,{type:'cancel',id:'b',at:4});a.equal(s.jobs.b.startedAt,2);a.equal(s.jobs.b.endedAt,4);a.throws(()=>state.transition(g,s,{type:'start',id:'a',at:5}))});
function successful(){const g=graph.createGraph(jobs),events=[{type:'start',id:'a',at:1},{type:'succeed',id:'a',at:5},{type:'start',id:'b',at:5},{type:'succeed',id:'b',at:7},{type:'start',id:'end',at:7},{type:'succeed',id:'end',at:10},{type:'cancel',id:'free',at:10}];return {g,events,s:events.reduce((s,e)=>state.transition(g,s,e),state.createState(g))}}
test('journal valid roundtrip/replay and metrics',()=>{const {g,events,s}=successful();a.deepEqual(journal.replay(freeze(g),freeze(events)),s);const text=journal.encodeState(g,freeze(s)),restored=journal.restoreState(g,text);a.deepEqual(restored,s);a.notEqual(restored.jobs.a,s.jobs.a);a.deepEqual(journal.metrics(g,s),{statuses:{pending:0,running:0,succeeded:3,failed:0,cancelled:1},attempts:3,totalRunTime:9,criticalPath:7});a.equal(JSON.parse(text).graphHash,require('node:crypto').createHash('sha256').update(JSON.stringify(g)).digest('hex'));a.equal(journal.metrics(graph.createGraph([]),state.createState(graph.createGraph([]))).criticalPath,0)});
test('journal rejects tampered envelopes',()=>{const {g,s}=successful(),base=JSON.parse(journal.encodeState(g,s));for(const alter of [e=>e.schema=2,e=>e.graphHash='x',e=>e.version++,e=>e.jobs.a.status='pending',e=>delete e.events[0].seq,e=>e.events[0].seq=2,e=>e.events[0].id='missing',e=>e.events.reverse(),e=>e.events.splice(1,1),e=>e.events.push(e.events[0])]){const e=structuredClone(base);alter(e);a.throws(()=>journal.restoreState(g,JSON.stringify(e)))}a.throws(()=>journal.restoreState(g,'{'));const forged=structuredClone(s);forged.jobs.a.status='running';a.throws(()=>journal.encodeState(g,forged));a.throws(()=>journal.replay(g,[{type:'start',id:'a',at:1,seq:4}]))});
test('journal accepts object key reordering and special ids',()=>{const g=graph.createGraph([{id:'__proto__'},{id:'constructor',deps:['__proto__']}]);let s=state.createState(g);for(const e of [{type:'start',id:'__proto__',at:0},{type:'succeed',id:'__proto__',at:1},{type:'start',id:'constructor',at:1}])s=state.transition(g,s,e);const e=JSON.parse(journal.encodeState(g,s));e.jobs=Object.fromEntries(Object.entries(e.jobs).reverse().map(([id,j])=>[id,Object.fromEntries(Object.entries(j).reverse())]));a.deepEqual(journal.restoreState(g,JSON.stringify(e)),s);a.equal({}.status,undefined)});
test('larger DAG scheduling/replay invariant',()=>{const input=freeze(Array.from({length:60},(_,i)=>({id:'j'+i,deps:i<3?[]:['j'+(i-3)],priority:i%7,duration:i%5,resource:'r'+i%3}))),g=graph.createGraph(input);let s=state.createState(g),clock=0;while(Object.values(s.jobs).some(j=>j.status==='pending')){const ready=scheduler.schedule(g,s,{now:clock,slots:3,capacities:{r0:1,r1:1,r2:1}});a.ok(ready.length>0);for(const id of ready)s=state.transition(g,freeze(s),{type:'start',id,at:clock});clock++;for(const id of ready)s=state.transition(g,freeze(s),{type:'succeed',id,at:clock})}a.equal(s.version,120);a.deepEqual(journal.restoreState(g,journal.encodeState(g,s)),s);a.equal(journal.metrics(g,s).statuses.succeeded,60);a.equal(journal.metrics(g,s).attempts,60)});
`;
