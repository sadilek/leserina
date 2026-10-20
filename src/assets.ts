// Pictures and clips are whatever lies in pictures/ and audio/ at build time, keyed by file name.
import type { Word } from './scheduler'
import { avatarById } from './avatars'

/** The picture styles, one folder each in pictures/; a child's profile picks one. The first is the default. */
export const PICTURE_STYLES = [
  { id: 'watercolour', label: 'Wasserfarben' },
  { id: 'clay', label: 'Knete' },
]

const pictureFiles = import.meta.glob('../pictures/*/*.{png,webp,jpg,jpeg}', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>
const audioFiles = import.meta.glob(['../audio/*.mp3', '../audio/stretched/*.mp3'], {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

/** Keyed by the file name without extension, below audio/ or pictures/: "hund", "stretched/hund", "clay/hund". */
const byName = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([path, url]) => [path.replace(/^.*?\/(audio|pictures)\/|\.[^.]+$/g, ''), url]))

const pictures = byName(pictureFiles)
const clips = byName(audioFiles)

/** The picture in the given style; else in another style, so a missing one does not show an emoji. */
export function pictureUrl(id: string, style: string) {
  const styles = [style, ...PICTURE_STYLES.map((s) => s.id)]
  for (const s of styles) {
    const url = pictures.get(`${s}/${id}`)
    if (url) return url
  }
}
export const clipUrl = (id: string) => clips.get(id)
/** The word read stretched, sound by sound (`scripts/render_stretched.py`). */
export const stretchedClipUrl = (id: string) => clips.get(`stretched/${id}`)
/** A child's name clip; a name that is also a word (Mama, Papa) uses the word's clip. */
export const nameClipUrl = (nameSlug: string) => clips.get(`name-${nameSlug}`) ?? clips.get(nameSlug)

/** Pastel card colours for placeholders, picked by the word so a word keeps its colour. */
const TINTS = ['#ffe3d6', '#fff1bf', '#d9f2d0', '#d6ecff', '#eadcff', '#ffd9e8']
function tint(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}

function image(url: string) {
  const img = document.createElement('img')
  img.src = url
  img.alt = ''
  img.draggable = false
  return img
}

/** The contents of a picture card: the picture if there is one, else the emoji on a tint. */
export function pictureFace(word: Word, style: string): HTMLElement {
  const face = document.createElement('div')
  face.className = 'face'
  const url = pictureUrl(word.id, style)
  if (url) {
    face.append(image(url))
  } else {
    face.classList.add('placeholder')
    face.style.background = tint(word.id)
    face.textContent = word.emoji
  }
  return face
}

export function avatarFace(avatarId: string, style: string): HTMLElement {
  const face = document.createElement('div')
  face.className = 'avatar-face'
  const url = pictureUrl(`avatar-${avatarId}`, style)
  if (url) face.append(image(url))
  else face.textContent = avatarById(avatarId).emoji
  return face
}
