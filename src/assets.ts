// Pictures and clips are whatever lies in pictures/ and audio/ at build time, keyed by file name.
import type { Word } from './scheduler'
import { avatarById } from './avatars'

const pictureFiles = import.meta.glob('../pictures/*.{png,webp,jpg,jpeg}', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>
const audioFiles = import.meta.glob('../audio/*.mp3', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const byName = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.[^.]+$/g, ''), url]))

const pictures = byName(pictureFiles)
const clips = byName(audioFiles)

export const pictureUrl = (id: string) => pictures.get(id)
export const clipUrl = (id: string) => clips.get(id)
export const nameClipUrl = (nameSlug: string) => clips.get(`name-${nameSlug}`)

/** Pastel card colours for placeholders, picked by the word so a word keeps its colour. */
const TINTS = ['#ffe3d6', '#fff1bf', '#d9f2d0', '#d6ecff', '#eadcff', '#ffd9e8']
function tint(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}

/** The contents of a picture card: the picture if there is one, else the emoji on a tint. */
export function pictureFace(word: Word): HTMLElement {
  const face = document.createElement('div')
  face.className = 'face'
  const url = pictureUrl(word.id)
  if (url) {
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    img.draggable = false
    face.append(img)
  } else {
    face.classList.add('placeholder')
    face.style.background = tint(word.id)
    face.textContent = word.emoji
  }
  return face
}

export function avatarFace(avatarId: string): HTMLElement {
  const face = document.createElement('div')
  face.className = 'avatar-face'
  const url = pictureUrl(`avatar-${avatarId}`)
  if (url) {
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    img.draggable = false
    face.append(img)
  } else {
    face.textContent = avatarById(avatarId).emoji
  }
  return face
}
