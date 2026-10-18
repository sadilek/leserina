// The parents' corner: children's profiles, their settings, and which words sit in which box.
import wordList from '../words.json'
import { avatarFace, clipUrl, nameClipUrl } from './assets'
import { AVATARS } from './avatars'
import { boxes, type Word } from './scheduler'
import { slug } from './slug'
import * as sound from './sound'
import { data, newProfile, save, type Profile } from './store'

const words = wordList as Word[]
const wordById = new Map(words.map((w) => [w.id, w]))

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...children: (Node | string)[]) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.append(...children)
  return e
}

function button(label: string, cls: string, onClick: () => void) {
  const b = h('button', cls, label)
  b.addEventListener('click', onClick)
  return b
}

/** A word that plays its clip when tapped; marked when no clip has been rendered for it. */
function wordChip(id: string) {
  const w = wordById.get(id)
  const chip = h('button', 'chip', w?.word ?? id)
  if (!clipUrl(id)) {
    chip.classList.add('no-clip')
    chip.title = 'Keine Aufnahme, das Gerät liest vor'
  }
  chip.addEventListener('click', () => {
    sound.unlock()
    if (w) void sound.sayWord(w.id, w.word)
  })
  return chip
}

export function parentsCorner(root: HTMLElement, onDone: () => void) {
  const screen = h('div', 'screen parents')
  const render = () => {
    const list = h('div', 'profiles')
    for (const p of data.profiles) list.append(profilePanel(p, render))
    const add = button('Kind hinzufügen', 'pill', () => {
      const used = new Set(data.profiles.map((p) => p.avatar))
      const avatar = AVATARS.find((a) => !used.has(a.id))?.id ?? AVATARS[0].id
      data.profiles.push(newProfile('', avatar))
      save()
      render()
      const inputs = screen.querySelectorAll<HTMLInputElement>('.name-input')
      inputs[inputs.length - 1]?.focus()
    })
    const head = h('header', 'parents-head', h('h1', '', 'Elternbereich'), button('Fertig', 'pill primary', () => {
      // A profile without a name would be a nameless avatar on the start screen.
      data.profiles = data.profiles.filter((p) => p.name.trim())
      save()
      onDone()
    }))
    screen.replaceChildren(head, list, add, listenSection())
  }
  render()
  root.replaceChildren(screen)
}

function profilePanel(p: Profile, rerender: () => void) {
  const panel = h('section', 'panel')

  const name = h('input', 'name-input')
  name.value = p.name
  name.placeholder = 'Name'
  name.autocomplete = 'off'
  const nameHint = h('p', 'hint')
  const updateHint = () => {
    nameHint.textContent =
      p.name.trim() && !nameClipUrl(slug(p.name))
        ? `Für „${p.name.trim()}“ gibt es noch keine Aufnahme; bis dahin liest das Gerät den Namen vor.`
        : ''
  }
  name.addEventListener('input', () => {
    p.name = name.value
    save()
    updateHint()
  })
  updateHint()

  const avatars = h('div', 'avatar-row')
  for (const a of AVATARS) {
    const b = h('button', `avatar-pick${a.id === p.avatar ? ' on' : ''}`, avatarFace(a.id))
    b.setAttribute('aria-label', a.id)
    b.addEventListener('click', () => {
      p.avatar = a.id
      save()
      rerender()
    })
    avatars.append(b)
  }

  const level = h('select', '')
  for (let l = 1; l <= 5; l++) {
    const sample = words.filter((w) => w.level === l).slice(0, 3).map((w) => w.word).join(', ')
    const o = h('option', '', `Stufe ${l}: ${sample} …`)
    o.value = String(l)
    level.append(o)
  }
  level.value = String(p.startLevel)
  level.addEventListener('change', () => {
    p.startLevel = Number(level.value)
    save()
  })

  const pairs = h('select', '')
  for (const n of [4, 5, 6]) {
    const o = h('option', '', `${n} Paare`)
    o.value = String(n)
    pairs.append(o)
  }
  pairs.value = String(p.pairs)
  pairs.addEventListener('change', () => {
    p.pairs = Number(pairs.value)
    save()
  })

  const settings = h('div', 'settings',
    h('label', '', h('span', '', 'Beginnt bei'), level),
    h('label', '', h('span', '', 'Pro Runde'), pairs),
  )

  const seen = Object.keys(p.learning.words).length
  const stats = h('p', 'stats',
    `${p.learning.round} Runden gespielt, ${p.coins} Münzen, ${seen} von ${words.length} Wörtern gesehen.`)

  const boxRow = h('div', 'boxes')
  const titles = ['Box 1: kommt jede Runde', 'Box 2', 'Box 3', 'Box 4', 'Box 5: sitzt']
  boxes(p.learning).forEach((ids, i) => {
    ids.sort((a, b) => (p.learning.words[b].wrong - p.learning.words[a].wrong) || a.localeCompare(b))
    const col = h('div', 'box', h('h3', '', titles[i]))
    const chips = h('div', 'chips')
    for (const id of ids) {
      const chip = wordChip(id)
      const wrong = p.learning.words[id].wrong
      if (wrong) chip.append(h('span', 'wrong-count', `${wrong}×`))
      chips.append(chip)
    }
    if (!ids.length) chips.append(h('span', 'none', 'leer'))
    col.append(chips)
    boxRow.append(col)
  })

  const actions = h('div', 'actions',
    button('Fortschritt zurücksetzen', 'pill quiet', () => {
      if (!confirm(`Lernstand und Münzen von ${p.name || 'diesem Kind'} zurücksetzen?`)) return
      const fresh = newProfile(p.name, p.avatar)
      Object.assign(p, { coins: 0, learning: fresh.learning, current: null })
      save()
      rerender()
    }),
    button('Profil löschen', 'pill quiet danger', () => {
      if (!confirm(`Profil von ${p.name || 'diesem Kind'} löschen?`)) return
      data.profiles = data.profiles.filter((x) => x !== p)
      save()
      rerender()
    }),
  )

  panel.append(
    h('div', 'panel-head', h('div', 'panel-avatar', avatarFace(p.avatar)), h('div', 'panel-name', name, nameHint)),
    avatars, settings, stats, boxRow, actions,
  )
  return panel
}

/** Every word by level, to listen through the clips once. */
function listenSection() {
  const missing = words.filter((w) => !clipUrl(w.id)).length
  const section = h('section', 'panel listen',
    h('h2', '', 'Alle Wörter anhören'),
    h('p', 'hint', missing
      ? `${missing} Wörter haben noch keine Aufnahme (gestrichelt); dort liest das Gerät vor.`
      : 'Tippe ein Wort an, um die Aufnahme zu hören.'),
  )
  for (let l = 1; l <= 5; l++) {
    const chips = h('div', 'chips')
    for (const w of words.filter((x) => x.level === l)) chips.append(wordChip(w.id))
    section.append(h('h3', '', `Stufe ${l}`), chips)
  }
  return section
}
