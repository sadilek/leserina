/** The ASCII file name for a word or name; the same as slug() in scripts/render_audio.py. */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/^-+|-+$/g, '')
}
