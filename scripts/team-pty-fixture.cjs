// Runs a single disposable interactive lead for the compatibility verifier.
// The parent owns lifecycle; no environment values are serialized back to it.
const readline = require('node:readline')
const pty = require('node-pty')
let terminal
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', line => {
  try {
    const message = JSON.parse(line)
    if (message.type === 'start' && !terminal) {
      terminal = pty.spawn(message.executable, message.args, { name: 'xterm-256color', cols: 140, rows: 45, cwd: message.cwd, env: process.env })
      emit({ type: 'started', pid: terminal.pid })
      terminal.onData(data => {
        if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R')
        if (data.includes('\x1b[c')) terminal.write('\x1b[?1;2c')
        emit({ type: 'data', data })
      })
      terminal.onExit(event => { emit({ type: 'exit', ...event }); setTimeout(() => process.exit(0), 50) })
    } else if (message.type === 'write' && terminal) terminal.write(message.data)
    else if (message.type === 'stop' && terminal) terminal.kill()
    else throw Error('Unsupported fixture control.')
  } catch { emit({ type: 'error', message: 'PTY fixture control failed.' }); process.exitCode = 1 }
})
lines.on('close', () => { terminal?.kill(); setTimeout(() => process.exit(0), 500) })
