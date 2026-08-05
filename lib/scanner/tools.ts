import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { delimiter, isAbsolute } from 'node:path'

export interface ToolCheck {
  available: boolean
  binary: string | null
  reason: string | null
}

export interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  command: string
}

function executableNames(name: string): string[] {
  if (process.platform !== 'win32') return [name]
  const pathext = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
  return pathext.map((ext) => `${name}${ext.toLowerCase()}`)
}

async function canAccessExecutable(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function findBinary(name: string, envVar?: string): Promise<ToolCheck> {
  const configured = envVar ? process.env[envVar]?.trim() : undefined
  if (configured) {
    if (await canAccessExecutable(configured)) {
      return { available: true, binary: configured, reason: null }
    }
    return {
      available: false,
      binary: null,
      reason: `${envVar} is set to "${configured}", but that file is not accessible.`,
    }
  }

  const paths = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const candidates = isAbsolute(name)
    ? [name]
    : paths.flatMap((dir) => executableNames(name).map((exe) => `${dir}/${exe}`))

  for (const candidate of candidates) {
    if (await canAccessExecutable(candidate)) {
      return { available: true, binary: candidate, reason: null }
    }
  }

  return {
    available: false,
    binary: null,
    reason: `Could not find "${name}" on PATH${envVar ? ` or ${envVar}` : ''}.`,
  }
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function commandLine(binary: string, args: string[]): string {
  return [binary, ...args].map(shellQuote).join(' ')
}

export function runCommand(
  binary: string,
  args: string[],
  options: { timeoutMs: number; input?: string; maxOutputBytes?: number },
): Promise<CommandResult> {
  const command = commandLine(binary, args)
  const maxOutputBytes = options.maxOutputBytes ?? 5 * 1024 * 1024

  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const trim = (value: string) =>
      value.length > maxOutputBytes ? value.slice(0, maxOutputBytes) : value

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: !timedOut && exitCode === 0,
        stdout: trim(stdout),
        stderr: trim(stderr),
        exitCode,
        timedOut,
        command,
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 1_000).unref()
    }, options.timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < maxOutputBytes) stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < maxOutputBytes) stderr += chunk
    })
    child.on('error', (error) => {
      stderr += error.message
      finish(null)
    })

    /*
     * Settle on `exit` as well as `close`.
     *
     * `close` fires only once every stdio pipe has closed, and a killed shell
     * can leave a grandchild holding those pipes open forever. `exit` fires as
     * soon as the child itself is gone. Listening to `close` alone meant the
     * promise never settled: the scan hung, its concurrency slot was never
     * released, and three of those permanently stopped a deployed instance
     * from accepting scans. See AUDIT C1.
     *
     * `finish` is idempotent via the `settled` flag, so whichever arrives
     * first wins and the other is ignored. `close` is still preferred when it
     * comes first, because by then all output has been flushed.
     */
    child.on('close', (code) => finish(code))
    child.on('exit', (code) => {
      // Give the pipes a moment to flush so output is not truncated when
      // `close` was going to arrive anyway.
      setTimeout(() => finish(code), 150).unref()
    })

    if (options.input) child.stdin.end(options.input)
    else child.stdin.end()
  })
}
