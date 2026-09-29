/** Frozen before measured runs. Acceptance files are independently authored and immutable. */
export interface EvaluationFixture { id: string; title: string; brief: string; editable: string[]; files: Record<string, string> }
const testHeader = "const {test}=require('node:test');const assert=require('node:assert/strict');\n"
export const evaluationFixtures: EvaluationFixture[] = [
  {
    id: 'cache-bug', title: 'Repair TTL/LRU cache behavior', editable: ['cache.cjs'],
    brief: 'Repair createCache({capacity,ttlMs,now}) in cache.cjs. capacity must be a positive integer; ttlMs a finite nonnegative number. Use an injected now() clock. Each set starts/renews TTL; expiration occurs at now >= expiry. get touches LRU only on a live hit; has does not touch. Expired entries must not consume capacity. Updating an existing key must not evict another live key. Support arbitrary string keys including __proto__ and undefined values (has distinguishes those from absent). delete returns whether a live key existed; size counts live entries. Preserve the API and do not modify acceptance tests.',
    files: {
      'cache.cjs': `exports.createCache=({capacity,ttlMs,now=Date.now})=>{const entries={};return {set(k,v){if(Object.keys(entries).length>=capacity)delete entries[Object.keys(entries)[0]];entries[k]={value:v,expires:now()+ttlMs};},get(k){const e=entries[k];return e&&e.expires>=now()?e.value:undefined;},has(k){return this.get(k)!==undefined;},delete(k){const present=k in entries;delete entries[k];return present;},get size(){return Object.keys(entries).length;}};};\n`,
      'acceptance.test.cjs': testHeader + `const{createCache}=require('./cache.cjs');
function clock(capacity=2,ttlMs=10){let time=0;return {cache:createCache({capacity,ttlMs,now:()=>time}),at:t=>time=t};}
test('expires at boundary and excludes expired size',()=>{const{cache:c,at}=clock();c.set('a',1);at(10);assert.equal(c.get('a'),undefined);assert.equal(c.has('a'),false);assert.equal(c.size,0);});
test('get refreshes LRU, not TTL',()=>{const{cache:c,at}=clock();c.set('a',1);c.set('b',2);at(4);assert.equal(c.get('a'),1);c.set('c',3);assert.equal(c.has('b'),false);assert.equal(c.has('a'),true);at(10);assert.equal(c.has('a'),false);});
test('has does not refresh LRU',()=>{const{cache:c}=clock();c.set('a',1);c.set('b',2);assert(c.has('a'));c.set('c',3);assert(!c.has('a'));assert(c.has('b'));});
test('renewal does not evict an unrelated entry',()=>{const{cache:c,at}=clock();c.set('a',1);c.set('b',2);at(6);c.set('b',20);assert(c.has('a'));at(12);assert.equal(c.get('b'),20);assert.equal(c.size,1);});
test('expired entries reclaimed before capacity eviction',()=>{const{cache:c,at}=clock();c.set('expired',1);at(6);c.set('live',2);at(11);c.set('new',3);assert.equal(c.get('live'),2);assert.equal(c.get('new'),3);assert.equal(c.size,2);});
test('special keys and undefined values are ordinary entries',()=>{const{cache:c}=clock(3);c.set('__proto__',undefined);c.set('constructor',7);assert(c.has('__proto__'));assert.equal(c.get('__proto__'),undefined);assert.equal(c.get('constructor'),7);assert(c.delete('__proto__'));assert(!c.delete('__proto__'));});
test('zero TTL immediately expires and delete ignores expired entries',()=>{const{cache:c}=clock(1,0);c.set('a',3);assert.equal(c.size,0);assert.equal(c.delete('a'),false);});
test('reject invalid configuration',()=>{for(const capacity of [0,-1,1.5,NaN])assert.throws(()=>createCache({capacity,ttlMs:1}),RangeError);for(const ttlMs of [-1,Infinity,NaN])assert.throws(()=>createCache({capacity:1,ttlMs}),RangeError);});
`
    }
  },
  {
    id: 'parallel-feature', title: 'Add independent catalog utilities', editable: ['slug.cjs', 'orders.cjs'],
    brief: 'Implement the two independent modules exported by index.cjs. slugify(text,maxLength=64): Unicode NFKD normalization, remove combining marks, ASCII lowercase alphanumeric runs joined by a single hyphen, trim separators, truncate to maxLength and trim trailing hyphens; nonstring text TypeError, nonpositive/noninteger maxLength RangeError. summarizeOrders(rows): rows array of {currency: USD or EUR, quantity: positive integer, unitCents: nonnegative safe integer}; reject invalid rows with TypeError, unsafe multiplication/sum with RangeError. Return [{currency,quantity,totalCents}] sorted by currency, combine matching currencies, empty input yields []; never mutate rows. With a Team, delegate these two modules as separate concurrent code tasks and verify the combined integrated result. Acceptance tests are immutable.',
    files: {
      'index.cjs': "exports.slugify=require('./slug.cjs').slugify;exports.summarizeOrders=require('./orders.cjs').summarizeOrders;\n",
      'slug.cjs': "exports.slugify=()=>{throw new Error('Not implemented')};\n",
      'orders.cjs': "exports.summarizeOrders=()=>{throw new Error('Not implemented')};\n",
      'acceptance.test.cjs': testHeader + `const{slugify,summarizeOrders}=require('./index.cjs');
test('normalizes accents and separators',()=>assert.equal(slugify('  Café déjà_vu & C++! '),'cafe-deja-vu-c'));
test('collapses separators and empty input',()=>{assert.equal(slugify('A---B__C'),'a-b-c');assert.equal(slugify('!!!'),'');assert.equal(slugify(''),'');});
test('truncates without dangling separators',()=>{assert.equal(slugify('alpha beta',6),'alpha');assert.equal(slugify('abcdef',3),'abc');});
test('validates slug arguments',()=>{assert.throws(()=>slugify(7),TypeError);for(const n of [0,-1,1.5,NaN])assert.throws(()=>slugify('a',n),RangeError);});
test('aggregates independent currencies with integer cents',()=>assert.deepEqual(summarizeOrders([{currency:'USD',quantity:2,unitCents:125},{currency:'EUR',quantity:3,unitCents:99},{currency:'USD',quantity:1,unitCents:50}]),[{currency:'EUR',quantity:3,totalCents:297},{currency:'USD',quantity:3,totalCents:300}]));
test('empty and zero-priced orders',()=>{assert.deepEqual(summarizeOrders([]),[]);assert.deepEqual(summarizeOrders([{currency:'USD',quantity:2,unitCents:0}]),[{currency:'USD',quantity:2,totalCents:0}]);});
test('does not mutate frozen input',()=>{const row=Object.freeze({currency:'EUR',quantity:1,unitCents:1});assert.equal(summarizeOrders(Object.freeze([row]))[0].totalCents,1);});
test('reject invalid rows',()=>{for(const row of [null,{}, {currency:'GBP',quantity:1,unitCents:1},{currency:'USD',quantity:0,unitCents:1},{currency:'USD',quantity:1.5,unitCents:1},{currency:'USD',quantity:1,unitCents:-1},{currency:'USD',quantity:1,unitCents:1.2}])assert.throws(()=>summarizeOrders([row]),TypeError);assert.throws(()=>summarizeOrders({}),TypeError);});
test('reject unsafe multiplication and aggregation',()=>{assert.throws(()=>summarizeOrders([{currency:'USD',quantity:2,unitCents:Number.MAX_SAFE_INTEGER}]),RangeError);assert.throws(()=>summarizeOrders([{currency:'USD',quantity:1,unitCents:Number.MAX_SAFE_INTEGER},{currency:'USD',quantity:1,unitCents:1}]),RangeError);});
`
    }
  },
  {
    id: 'stream-refactor', title: 'Refactor account rollup to one pass', editable: ['rollup.cjs'],
    brief: 'Refactor rollup(events) to consume a potentially one-shot iterable exactly once and aggregate in one pass, using O(number of accounts) auxiliary memory. Preserve array behavior: ignore null/malformed rows; valid rows have nonempty string account, kind credit or debit, and finite nonnegative amount. Account strings are case-sensitive and preserved. Return sorted [{account,credits,debits,balance,count}], with credits/debits totals and balance=credits-debits; zero amounts count. Do not mutate input, buffer all events, repeatedly scan them, or change acceptance tests. Tests include frozen arrays and a one-shot generator.',
    files: {
      'rollup.cjs': `exports.rollup=events=>{const valid=events.filter(e=>e&&typeof e.account==='string'&&e.account.length>0&&['credit','debit'].includes(e.kind)&&Number.isFinite(e.amount)&&e.amount>=0);return [...new Set(valid.map(e=>e.account))].sort().map(account=>{const rows=valid.filter(e=>e.account===account);const credits=rows.filter(e=>e.kind==='credit').reduce((n,e)=>n+e.amount,0),debits=rows.filter(e=>e.kind==='debit').reduce((n,e)=>n+e.amount,0);return{account,credits,debits,balance:credits-debits,count:rows.length};});};\n`,
      'acceptance.test.cjs': testHeader + `const{rollup}=require('./rollup.cjs');
const reference=events=>{const out=new Map();for(const e of events){if(!e||typeof e.account!=='string'||!e.account.length||!['credit','debit'].includes(e.kind)||!Number.isFinite(e.amount)||e.amount<0)continue;const r=out.get(e.account)||{account:e.account,credits:0,debits:0,balance:0,count:0};r[e.kind==='credit'?'credits':'debits']+=e.amount;r.count++;out.set(e.account,r);}return [...out.values()].sort((a,b)=>a.account<b.account?-1:a.account>b.account?1:0).map(r=>({...r,balance:r.credits-r.debits}));};
test('preserves credit/debit behavior and sorting',()=>{const rows=[{account:'b',kind:'credit',amount:8},{account:'a',kind:'debit',amount:3},{account:'b',kind:'debit',amount:2},{account:'a',kind:'credit',amount:0}];assert.deepEqual(rollup(rows),reference(rows));});
test('ignores malformed records',()=>{const rows=[null,{}, {account:'',kind:'credit',amount:1},{account:'a',kind:'other',amount:1},{account:'a',kind:'credit',amount:NaN},{account:'a',kind:'credit',amount:-1}];assert.deepEqual(rollup(rows),[]);});
test('special account names do not collide',()=>{const rows=['__proto__','constructor','A','a'].map(account=>({account,kind:'credit',amount:2}));assert.deepEqual(rollup(rows),reference(rows));});
test('frozen input remains untouched',()=>{const rows=Object.freeze([Object.freeze({account:'a',kind:'credit',amount:4})]);assert.deepEqual(rollup(rows),reference(rows));});
test('one-shot iterable is consumed once',()=>{let iterators=0,yields=0;const rows=Array.from({length:100},(_,i)=>({account:'a'+i%7,kind:i%2?'credit':'debit',amount:i}));const input={[Symbol.iterator](){assert.equal(++iterators,1);return(function*(){for(const r of rows){yields++;yield r;}})();}};assert.deepEqual(rollup(input),reference(rows));assert.equal(yields,100);});
test('deterministic broad regression sample',()=>{let seed=12345;const rows=[];for(let i=0;i<500;i++){seed=(seed*1664525+1013904223)>>>0;rows.push({account:'acct'+seed%19,kind:seed%3?'credit':'debit',amount:seed%1000});}assert.deepEqual(rollup(rows),reference(rows));});
test('empty iterable',()=>assert.deepEqual(rollup((function*(){})()),[]));
`
    }
  }
]
