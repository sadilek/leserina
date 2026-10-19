// The parents' corner: children's profiles, their settings, and which words sit in which box.
import wordList from '../words.json'
import { avatarFace, clipUrl, nameClipUrl, pictureFace, PICTURE_STYLES } from './assets'
import { AVATARS } from './avatars'
import { boxes, type Word } from './scheduler'
import { slug } from './slug'
import * as sound from './sound'
import { codeWords, newCode, parseCode } from './familycode'
import * as store from './store'
import { addProfile, deleteProfile, profiles, resetProfile, setField, type Profile } from './store'
import { connect, leaveFamily, sync, type Problem } from './sync'

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
    for (const p of profiles) list.append(profilePanel(p, render))
    const add = button('Kind hinzufügen', 'pill', () => {
      const used = new Set(profiles.map((p) => p.avatar))
      const avatar = AVATARS.find((a) => !used.has(a.id))?.id ?? AVATARS[0].id
      addProfile('', avatar)
      render()
      const inputs = screen.querySelectorAll<HTMLInputElement>('.name-input')
      inputs[inputs.length - 1]?.focus()
    })
    const head = h('header', 'parents-head', h('h1', '', 'Elternbereich'), button('Fertig', 'pill primary', () => {
      // A profile without a name would be a nameless avatar on the start screen.
      for (const p of profiles.filter((p) => !p.name.trim())) deleteProfile(p)
      void sync()
      onDone()
    }))
    const devices = devicesSection(render)
    // On a new device, joining the family comes first: it brings the children's profiles along.
    if (profiles.length) screen.replaceChildren(head, list, add, devices, listenSection(), version())
    else screen.replaceChildren(head, devices, list, add, listenSection(), version())
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
    setField(p, 'name', name.value)
    updateHint()
  })
  updateHint()

  const avatars = h('div', 'avatar-row')
  for (const a of AVATARS) {
    const b = h('button', `avatar-pick${a.id === p.avatar ? ' on' : ''}`, avatarFace(a.id, p.pictures))
    b.setAttribute('aria-label', a.id)
    b.addEventListener('click', () => {
      setField(p, 'avatar', a.id)
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
  level.addEventListener('change', () => setField(p, 'startLevel', Number(level.value)))

  const pairs = h('select', '')
  for (const n of [4, 5, 6]) {
    const o = h('option', '', `${n} Paare`)
    o.value = String(n)
    pairs.append(o)
  }
  pairs.value = String(p.pairs)
  pairs.addEventListener('change', () => setField(p, 'pairs', Number(pairs.value)))

  // Each style shows the dog in it, so parents see what they pick.
  const dog = wordById.get('hund')!
  const styles = h('div', 'style-pick')
  for (const s of PICTURE_STYLES) {
    const b = h('button', s.id === p.pictures ? 'on' : '', pictureFace(dog, s.id), h('span', '', s.label))
    b.addEventListener('click', () => {
      setField(p, 'pictures', s.id)
      rerender()
    })
    styles.append(b)
  }

  const settings = h('div', 'settings',
    h('label', '', h('span', '', 'Beginnt bei'), level),
    h('label', '', h('span', '', 'Pro Runde'), pairs),
    h('div', 'setting', h('span', '', 'Bilder'), styles),
  )

  const seen = Object.keys(p.learning.words).length
  const stats = h('p', 'stats',
    `${p.learning.round} Runden gespielt, ${p.coins} Sterne, ${seen} von ${words.length} Wörtern gesehen.`)

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
      if (!confirm(`Lernstand und Sterne von ${p.name || 'diesem Kind'} zurücksetzen?`)) return
      resetProfile(p)
      rerender()
    }),
    button('Profil löschen', 'pill quiet danger', () => {
      if (!confirm(`Profil von ${p.name || 'diesem Kind'} löschen?`)) return
      deleteProfile(p)
      rerender()
    }),
  )

  // Two devices that each had a profile for the same child before they were connected.
  const key = (q: Profile) => q.name.trim().toLowerCase()
  const twin = key(p) && profiles.some((q) => q !== p && key(q) === key(p))
  const twinHint = twin
    ? h('p', 'hint warn', `Es gibt zwei Profile „${p.name.trim()}“, wohl von zwei Geräten. Ihre Sterne und Lernstände ` +
      'werden nicht zusammengelegt: Lösche das, das du nicht mehr brauchst.')
    : ''

  panel.append(
    h('div', 'panel-head', h('div', 'panel-avatar', avatarFace(p.avatar, p.pictures)), h('div', 'panel-name', name, nameHint)),
    twinHint, avatars, settings, stats, boxRow, actions,
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

const PROBLEMS: Record<Problem | 'typo', string> = {
  typo: 'Der Code besteht aus fünf Wörtern. Bitte prüfen.',
  unknown: 'Diesen Code gibt es nicht. Bitte prüfen; erstellt wird er auf dem ersten Gerät.',
  offline: 'Keine Verbindung zum Server. Ist das Gerät online?',
  full: 'Mit diesem Code sind schon zu viele Geräte verbunden.',
}

const loadWords = () => import('./family-words.txt?raw').then((m) => codeWords(m.default))

/** When the running version was built, so parents can tell whether an update has arrived. */
function version() {
  const d = new Date(__BUILD_TIME__)
  const day = d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return h('p', 'hint version', `Version vom ${day}, ${time}`)
}

function syncedAt(t: number | null) {
  if (!t) return 'Noch nicht synchronisiert.'
  const d = new Date(t)
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const day = d.toDateString() === new Date().toDateString() ? 'heute' : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })
  return `Zuletzt synchronisiert: ${day}, ${time}.`
}

/** "Geräte verbinden": one family code shared by the devices, typed in on each of them. */
function devicesSection(rerender: () => void) {
  const section = h('section', 'panel devices', h('h2', '', 'Geräte verbinden'))
  const message = h('p', 'hint warn')
  const busy = async (b: HTMLButtonElement, work: () => Promise<Problem | 'typo' | null>) => {
    b.disabled = true
    message.textContent = ''
    const problem = await work()
    b.disabled = false
    if (problem) message.textContent = PROBLEMS[problem]
    else rerender()
  }

  const code = store.family()
  if (code) {
    const words = h('div', 'family-code')
    for (const w of code.split('-')) words.append(h('span', '', w))
    const status = h('p', 'hint', syncedAt(store.lastSync()))
    const now = button('Jetzt synchronisieren', 'pill quiet', () =>
      void busy(now, async () => ((await sync()) ? null : 'offline')))
    section.append(
      h('p', '', 'Familien-Code. Auf dem anderen Gerät hier im Elternbereich eingeben:'),
      words, status, message,
      h('div', 'actions', now, button('Trennen', 'pill quiet danger', () => {
        if (!confirm('Dieses Gerät trennen? Der Fortschritt bleibt hier, wird aber nicht mehr abgeglichen.')) return
        leaveFamily()
        rerender()
      })),
    )
    return section
  }

  const input = h('input', 'code-input')
  input.placeholder = 'fünf Wörter, z. B. abend kiste …'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.setAttribute('autocapitalize', 'none')
  input.setAttribute('autocorrect', 'off')
  const join = button('Verbinden', 'pill primary', () => void busy(join, async () => {
    const parsed = parseCode(input.value, await loadWords())
    return parsed ? connect(parsed, false) : 'typo'
  }))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join.click()
  })
  const create = button('Neuen Familien-Code erstellen', 'pill', () => void busy(create, async () =>
    connect(newCode(await loadWords()), true)))
  section.append(
    h('p', '', 'Verbundene Geräte teilen die Profile, Sterne und den Lernstand der Kinder, z. B. iPad und Handy. ' +
      'Dafür liegen Namen, Tiere, Einstellungen, Lernstand und Sterne auf einem Server, unter einem Familien-Code. ' +
      'Ein Konto gibt es nicht.'),
    h('h3', '', 'Erstes Gerät'),
    h('div', 'actions', create),
    h('h3', '', 'Weiteres Gerät: den Code vom ersten Gerät eingeben'),
    h('div', 'code-entry', input, join),
    message,
  )
  return section
}
