import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
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
