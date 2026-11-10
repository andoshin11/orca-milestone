// Sends what is picked in the cards under the focused workspace. A pressed card turns to show it and
// the others stop taking presses; the worker's next body, once the agent moves on, takes the cards
// away. When nothing was sent, a line under the cards says why and they take presses again.
// - A form's options are ticked here and sent together with its button. The worker's bodies would
//   drop the ticks, so they are kept per form and put back after every patch (`restore`).
// - Allowing a dangerous command takes two presses: the first only asks for the second.
// Listeners sit on the root, so they keep working however the cards are patched.

const MESSAGES = {
  stale: 'この選択肢はもう使えません。エージェントが先に進んだか、すでに押されています。',
  typing: 'Codex の入力欄に書きかけの文字があるため、送りませんでした。',
  confirm: '危険なコマンドです。実行してよければ、もう一度押してください。',
  failed: '送信に失敗しました。'
}

function showStatus(within, text) {
  const next = within.closest('.next')
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
  // Ticks per form, by offer: an array of option sets, one per question.
  const picks = new Map()
  let busy = false

  async function deliver(element, request) {
    busy = true
    const next = element.closest('.next')
    next?.classList.add('busy')
    element.classList.add('sending')
    let result
    try {
      result = await send(request)
    } catch {
      result = { sent: false, reason: 'failed' }
    }
    busy = false
    if (result?.sent) {
      picks.delete(request.offer)
      return
    }
    element.classList.remove('sending')
    next?.classList.remove('busy')
    if (result?.reason === 'confirm') element.classList.add('armed')
    showStatus(element, MESSAGES[result?.reason] ?? MESSAGES.failed)
  }

  function restore() {
    for (const button of root.querySelectorAll('[data-option]')) {
      const chosen = picks.get(button.getAttribute('data-form'))?.[Number(button.getAttribute('data-question'))]
      button.classList.toggle('chosen', Boolean(chosen?.has(Number(button.getAttribute('data-option')))))
    }
    for (const submit of root.querySelectorAll('[data-submit]')) {
      const chosen = picks.get(submit.getAttribute('data-submit')) ?? []
      const count = Number(submit.getAttribute('data-count'))
      submit.disabled = busy || chosen.filter((set) => set?.size > 0).length !== count
    }
  }

  function pick(option) {
    const offer = option.getAttribute('data-form')
    const position = Number(option.getAttribute('data-question'))
    const index = Number(option.getAttribute('data-option'))
    const chosen = picks.get(offer) ?? []
    const set = option.getAttribute('data-multi') === '1' ? new Set(chosen[position]) : new Set()
    if (set.has(index)) set.delete(index)
    else set.add(index)
    chosen[position] = set
    picks.set(offer, chosen)
    restore()
  }

  root.addEventListener('click', (event) => {
    if (busy) return
    const option = event.target.closest('[data-option]')
    if (option) {
      pick(option)
      return
    }
    const submit = event.target.closest('[data-submit]')
    if (submit) {
      if (submit.disabled) return
      const offer = submit.getAttribute('data-submit')
      const answers = (picks.get(offer) ?? []).map((set) => [...set].sort((a, b) => a - b))
      void deliver(submit, { offer, answers }).then(restore)
      return
    }
    const card = event.target.closest('[data-next]')
    if (!card) return
    const dangerous = card.getAttribute('data-dangerous') === '1'
    if (dangerous && !card.classList.contains('armed')) {
      card.classList.add('armed')
      showStatus(card, MESSAGES.confirm)
      return
    }
    void deliver(card, { offer: card.getAttribute('data-next'), index: Number(card.getAttribute('data-index')), ...(dangerous ? { confirmed: true } : {}) })
  })

  return { restore }
}
