// Transparent stdio observer for the installed Neo4j MCP package. The only
// recorded query is a constant RETURN challenge; no graph data is read or written.
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const readline = require('node:readline')
const nonce = process.env.CHORUS_NEO4J_PROBE
const evidence = process.env.CHORUS_NEO4J_EVIDENCE
if (!nonce || !evidence) throw Error('Missing disposable Neo4j probe configuration')
fs.writeFileSync(evidence+'.startup.json',JSON.stringify({pid:process.pid,cwd:process.cwd(),at:new Date().toISOString()}))
const child = spawn(process.env.CHORUS_NEO4J_UVX ?? 'uvx', ['--offline', 'mcp-neo4j-cypher'], { env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
const requests = new Set()
readline.createInterface({ input: process.stdin }).on('line', line => {
  try {
    const message = JSON.parse(line)
    if (message.method === 'tools/call') {
      const query = message.params?.arguments?.query
      if (message.params?.name?.endsWith('read_neo4j_cypher') && query?.trim() === `RETURN '${nonce}' AS chorus_probe`) requests.add(message.id)
    }
  } catch {}
  child.stdin.write(line + '\n')
}).on('close', () => child.stdin.end())
readline.createInterface({ input: child.stdout }).on('line', line => {
  try {
    const message = JSON.parse(line)
    if (requests.has(message.id) && !message.error && !message.result?.isError && JSON.stringify(message.result).includes(nonce)) {
      fs.writeFileSync(evidence, JSON.stringify({ passed: true, installedPackage: 'mcp-neo4j-cypher', offlineCacheOnly: true, constantReadQuery: true, response: message.result, at: new Date().toISOString() }, null, 2))
    }
  } catch {}
  process.stdout.write(line + '\n')
})
child.stderr.on('data',data=>{fs.appendFileSync(evidence+'.stderr.log',data);process.stderr.write(data)})
child.on('error', error => { fs.writeFileSync(evidence+'.error.json',JSON.stringify({message:error.message}));process.stderr.write(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
