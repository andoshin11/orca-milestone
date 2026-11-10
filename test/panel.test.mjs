import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { scrollExpandedRows } from '../panel/expand.mjs'
import { openOnPress } from '../panel/open.mjs'
import { patchChildren } from '../panel/patch.mjs'

const panelDir = join(import.meta.dirname, '..', 'panel')

function body(html = '') {
  const { document } = new JSDOM('<!doctype html><body></body>').window
  document.body.innerHTML = html
  return document.body
}

test('patchChildren keeps the elements that stay and updates what differs', () => {
  const root = body('<main class="a"><p>old</p></main><div class="others"><ol><li>one</li></ol></div>')
  const [main, others] = root.children
  const list = others.querySelector('ol')
  const item = list.querySelector('li')

  patchChildren(root, '<main class="b"><p>new</p></main><div class="others"><ol><li>uno</li><li>two</li></ol></div>')

  assert.equal(root.children[0], main, 'the element is the same one')
  assert.equal(main.className, 'b')
  assert.equal(main.textContent, 'new')
  assert.equal(root.querySelector('ol'), list)
  assert.equal(list.children[0], item)
  assert.equal(item.textContent, 'uno')
  assert.equal(list.children[1].textContent, 'two')
})

test('patchChildren replaces other tags, drops extras and removes old attributes', () => {
  const root = body('<p id="x" class="y">text</p><span>a</span><span>b</span>')
  patchChildren(root, '<div class="y">text</div><span>a</span>')
  assert.equal(root.innerHTML, '<div class="y">text</div><span>a</span>')

  patchChildren(root, '<div>text</div>')
  assert.equal(root.innerHTML, '<div>text</div>')
})

test('patchChildren replaces an element whose data-key differs, and keeps one whose key is the same', () => {
  const root = body('<section data-key="a"><p>0 / 2</p></section>')
  const section = root.children[0]

  patchChildren(root, '<section data-key="a"><p>1 / 2</p></section>')
  assert.equal(root.children[0], section)
  assert.equal(section.textContent, '1 / 2')

  patchChildren(root, '<section data-key="b"><p>0 / 5</p></section>')
  assert.notEqual(root.children[0], section)
  assert.equal(root.children[0].textContent, '0 / 5')
})

test('patchChildren ends with exactly the wanted markup, from an empty panel too', () => {
  const root = body()
  const html = '<main><header><h1>app</h1></header></main><div class="others"><h2>x</h2></div>'
  patchChildren(root, html)
  assert.equal(root.innerHTML, html)
})

test('the panel document loads its stylesheet and script', async () => {
  const html = await readFile(join(panelDir, 'index.html'), 'utf8')
  assert.ok(html.includes('href="style.css"'))
  assert.ok(html.includes('src="main.mjs"'))
  await readFile(join(panelDir, 'style.css'), 'utf8')
  await readFile(join(panelDir, 'main.mjs'), 'utf8')
})

test('pressing a row head opens its workspace, also after a patch, but its detail does not', () => {
  const row = (path) =>
    `<li class="row"><div class="head" role="button" tabindex="0" data-open="${path}"><span class="name">app</span></div><div class="detail"><p>goal</p></div></li>`
  const root = body(`<ol>${row('/work/a')}</ol>`)
  const opened = []
  openOnPress(root, (path) => opened.push(path))
  const { MouseEvent, KeyboardEvent } = root.ownerDocument.defaultView
  const click = (selector) => root.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true }))

  click('.name')
  assert.deepEqual(opened, ['/work/a'])

  click('.detail p')
  assert.equal(opened.length, 1)

  patchChildren(root, `<ol>${row('/work/b')}</ol>`)
  click('.head')
  assert.equal(opened.at(-1), '/work/b')

  const press = (key) => root.querySelector('.head').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  press('Enter')
  press(' ')
  press('a')
  assert.equal(opened.length, 4)
})

test('the wheel over a head scrolls its tasks, and opening starts at what is left', () => {
  const root = body(
    '<li class="row"><div class="head"><span class="name">app</span></div><div class="detail"><div class="inner"><ol><li class="completed">a</li><li class="pending">b</li></ol></div></div></li><li class="row"><div class="head"><span class="name">bare</span></div></li>'
  )
  scrollExpandedRows(root)
  const { MouseEvent, WheelEvent } = root.ownerDocument.defaultView
  const inner = root.querySelector('.inner')
  root.querySelector('li.pending').getBoundingClientRect = () => ({ top: 300 })
  inner.getBoundingClientRect = () => ({ top: 100 })

  const enter = (from) => root.querySelector('.name').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: from }))
  enter(root.ownerDocument.body)
  assert.equal(inner.scrollTop, 176, 'the task left, with a little of what came before it')

  enter(inner)
  assert.equal(inner.scrollTop, 176, 'coming back from its own tasks does not jump')

  root.querySelector('.name').dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }))
  assert.equal(inner.scrollTop, 216)

  root.querySelectorAll('.name')[1].dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }))
  assert.equal(inner.scrollTop, 216, 'a row with no tasks has nothing to scroll')
})

test('a pressed card is sent once, and a refusal says why and lets the cards be pressed again', async () => {
  const { sendOnPress } = await import('../panel/next.mjs')
  const root = body('<main><div class="next"><ol class="actions"><li><button data-next="o1" data-index="0">A</button></li><li><button data-next="o1" data-index="1">B</button></li></ol></div></main>')
  const requests = []
  let answer = { sent: false, reason: 'typing' }
  sendOnPress(root, async (request) => {
    requests.push(request)
    return answer
  })
  const [a, b] = root.querySelectorAll('[data-next]')
  b.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(requests, [{ offer: 'o1', index: 1 }])
  assert.match(root.querySelector('.status').textContent, /書きかけ/)
  assert.ok(!root.querySelector('.actions').classList.contains('busy'))

  answer = { sent: true }
  a.click()
  a.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(requests.length, 2, 'a second click while one is on its way is ignored')
  assert.ok(a.classList.contains('sending'))
  assert.ok(root.querySelector('.actions').classList.contains('busy'))
})
