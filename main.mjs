// Orca plugin worker entry for orca-milestone: shows the Claude tasks of the focused workspace
// as milestones in a right-sidebar panel.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createMilestoneWorker } from './src/milestone-worker.mjs'
import { resolveOrcaCli } from './src/orca-cli.mjs'

export default function activate(orca) {
  const worker = createMilestoneWorker({
    orca,
    home: homedir(),
    panelPath: join(import.meta.dirname, 'panel', 'index.html'),
    cli: resolveOrcaCli()
  })
  // Orca starts the worker lazily, on the first command or event.
  orca.commands.register('milestone.refresh', async () => {
    await worker.start()
    await worker.refresh(true)
    return 'Milestones refreshed'
  })
  orca.events.on('agent.status.changed', async () => {
    await worker.start()
    worker.schedule(true)
  })
}
