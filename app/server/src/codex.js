/* Running the Codex CLI as this deployment's model.

   The assistant answers with a personal Codex account rather than an API key:
   `codex login` happens once on a laptop, and the resulting auth.json travels
   to the box as a secret. Codex rotates its own tokens and rewrites that file,
   so the seeded copy must live on a volume and must NOT be re-written on every
   boot — a stale seed would clobber the fresher token Codex saved. The marker
   file remembers which secret was seeded; only a changed secret re-seeds. */

import { spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function prepareCodexHome({ home, authJsonB64, mcpUrl = null }) {
  const auth = Buffer.from(String(authJsonB64), 'base64').toString('utf8')
  JSON.parse(auth) // a garbled secret should fail here, loudly, not mid-question
  await mkdir(path.join(home, 'work'), { recursive: true })
  /* The agent's one window on the world: this server's own MCP endpoint over
     loopback. The token is not written here — it is minted per question for
     the asking user and arrives in the environment of that one spawn. */
  if (mcpUrl) {
    await writeFile(
      path.join(home, 'config.toml'),
      '# Written on every boot; the assistant owns this home. Do not edit.\n' +
        '[mcp_servers.offwego]\n' +
        `url = "${mcpUrl}"\n` +
        'bearer_token_env_var = "OFFWEGO_MCP_TOKEN"\n',
      { mode: 0o600 },
    )
  }
  const hash = createHash('sha256').update(auth).digest('hex')
  const marker = path.join(home, '.auth-seed-sha256')
  const seeded = await readFile(marker, 'utf8').catch(() => null)
  const hasAuth = await readFile(path.join(home, 'auth.json'), 'utf8')
    .then(() => true)
    .catch(() => false)
  if (hasAuth && seeded?.trim() === hash) return false
  await writeFile(path.join(home, 'auth.json'), auth, { mode: 0o600 })
  await writeFile(marker, hash, { mode: 0o600 })
  return true
}

/* One question, one process, one agent loop. `codex exec` gets the prompt on
   stdin and loops over the MCP tools in config.toml until it has an answer;
   the read-only sandbox and empty working directory are for its shell, which
   it has no reason to use. The reply comes back through the file that
   --output-last-message writes, because stdout is a transcript, not an
   answer. */
export function createCodexRunner({
  home,
  model = null,
  reasoningEffort = null,
  binary = 'codex',
  timeoutMs = 300_000,
  spawn = nodeSpawn,
}) {
  return async function run(prompt, { env: extraEnv = {} } = {}) {
    const outFile = path.join(
      home,
      `reply-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    )
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--cd',
      path.join(home, 'work'),
      '--output-last-message',
      outFile,
      ...(model ? ['--model', model] : []),
      ...(reasoningEffort ? ['-c', `model_reasoning_effort="${reasoningEffort}"`] : []),
      '-',
    ]
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(binary, args, {
          env: { ...process.env, ...extraEnv, CODEX_HOME: home },
          stdio: ['pipe', 'ignore', 'pipe'],
        })
        let stderr = ''
        let settled = false
        const settle = handler => value => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          handler(value)
        }
        const succeed = settle(resolve)
        const fail = settle(reject)
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          // The stderr tail rides along: a hang usually names its cause there
          // ("waiting for network", a certificate error), and losing it once
          // cost a production debugging session a container-level repro.
          fail(new Error(`codex exec did not answer within ${timeoutMs}ms: ${stderr.trim()}`))
        }, timeoutMs)
        timer.unref?.()
        child.stderr.on('data', chunk => {
          stderr = (stderr + chunk).slice(-2000)
        })
        child.on('error', fail)
        child.on('close', code => {
          if (code === 0) succeed()
          else fail(new Error(`codex exec exited with ${code}: ${stderr.trim()}`))
        })
        child.stdin.on('error', () => {}) // a crashed codex must surface via close, not EPIPE
        child.stdin.end(prompt)
      })
      const reply = (await readFile(outFile, 'utf8')).trim()
      if (!reply) throw new Error('codex exec produced an empty reply')
      return reply
    } finally {
      await rm(outFile, { force: true }).catch(() => {})
    }
  }
}
