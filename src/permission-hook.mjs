// Claude Code's PermissionRequest hook, which the launch hook adds to every Claude session: it allows
// a call that "allow the rest of this turn" covers (turn-grant.mjs), and otherwise says nothing, so
// that Claude Code asks the user as usual. It reads its input from stdin and must never fail a call:
// any error leaves the decision to the user.
import { homedir } from 'node:os'
import { allowFromGrant } from './turn-grant.mjs'

const ALLOW = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

try {
  const input = JSON.parse(await readStdin())
  if (await allowFromGrant({ home: homedir(), input })) process.stdout.write(JSON.stringify(ALLOW))
} catch {
  // Asking the user is always safe.
}
