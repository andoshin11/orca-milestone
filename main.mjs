// Orca plugin worker entry for orca-milestone: shows the Claude tasks of the focused workspace
// as milestones in a right-sidebar panel.
import { homedir } from 'node:os'
import { enableTaskTools } from './src/launch-hook.mjs'
import { createMilestoneWorker } from './src/milestone-worker.mjs'
import { resolveOrcaCli } from './src/orca-cli.mjs'

export default function activate(orca) {
  const worker = createMilestoneWorker({
    orca,
    home: homedir(),
    cli: resolveOrcaCli()
  })
  orca.hooks.on('agent.launch.before', enableTaskTools)
  orca.panels.handle('view.get', () => worker.view())
  orca.panels.handle('workspace.open', ({ path }) => worker.openWorkspace(path))
  orca.commands.register('milestone.refresh', async () => {
    await worker.start()
    await worker.refresh(true)
    return 'Milestones refreshed'
  })
  orca.events.on('agent.status.changed', async (event) => {
    await worker.start()
    worker.agentChanged(event)
  })
  orca.events.on('workspace.changed', async () => {
    await worker.start()
    worker.schedule(true)
  })
}
