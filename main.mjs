// Orca plugin worker entry for orca-milestone.
export default function activate(orca) {
  orca.commands.register('milestone.hello', () => {
    orca.log('milestone: hello')
  })
}
