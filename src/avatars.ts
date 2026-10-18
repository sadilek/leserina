export interface Avatar {
  id: string
  emoji: string
}

/** Animals a child can pick. A picture pictures/avatar-<id>.png replaces the emoji. */
export const AVATARS: Avatar[] = [
  { id: 'fuchs', emoji: '🦊' },
  { id: 'baer', emoji: '🐻' },
  { id: 'hase', emoji: '🐰' },
  { id: 'katze', emoji: '🐱' },
  { id: 'hund', emoji: '🐶' },
  { id: 'loewe', emoji: '🦁' },
  { id: 'frosch', emoji: '🐸' },
  { id: 'panda', emoji: '🐼' },
  { id: 'eule', emoji: '🦉' },
  { id: 'pinguin', emoji: '🐧' },
  { id: 'koala', emoji: '🐨' },
  { id: 'einhorn', emoji: '🦄' },
]

export function avatarById(id: string): Avatar {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0]
}
