// Sends a pressed next-step card. The card turns to show it was pressed and the others stop taking
// presses; the worker's next body, once the agent is at work, takes the cards away. When nothing
// was sent, a line under the cards says why and they take presses again. The listener sits on the
// root, so it keeps working however the cards are patched.

const MESSAGES = {
  stale: 'このボタンはもう使えません。エージェントが次のターンに進んだか、すでに押されています。',
  typing: 'Codex の入力欄に書きかけの文字があるため、送りませんでした。',
  failed: '送信に失敗しました。'
}

function showStatus(card, text) {
  const next = card.closest('.next')
  if (!next) return
  let status = next.querySelector('.status')
  if (!status) {
    status = next.ownerDocument.createElement('p')
    status.className = 'status'
    next.appendChild(status)
  }
  status.textContent = text
}

export function sendOnPress(root, send) {
  root.addEventListener('click', async (event) => {
    const card = event.target.closest('[data-next]')
    if (!card || card.closest('.actions')?.classList.contains('busy')) return
    const list = card.closest('.actions')
    list?.classList.add('busy')
    card.classList.add('sending')
    let result
    try {
      result = await send({ offer: card.getAttribute('data-next'), index: Number(card.getAttribute('data-index')) })
    } catch {
      result = { sent: false, reason: 'failed' }
    }
    if (result?.sent) return
    card.classList.remove('sending')
    list?.classList.remove('busy')
    showStatus(card, MESSAGES[result?.reason] ?? MESSAGES.failed)
  })
}
