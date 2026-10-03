export const TAGS = [
  'Applied',
  'Rejected',
  'Meeting',
  'Questions',
  'Junk',
  'Needs Attention',
  'Other'
] as const

export type Tag = (typeof TAGS)[number]

/** Colors are desaturated so they sit together on the frosted panels; they are the only hues in the UI. */
export const TAG_INFO: Record<Tag, { meaning: string; color: string }> = {
  Applied: { meaning: 'Company confirms they received the application', color: '#3d6aa8' },
  Rejected: { meaning: 'Company rejected the application', color: '#b04a3f' },
  Meeting: { meaning: 'Company wants to talk, or sent a meeting/interview link', color: '#2f8559' },
  Questions: { meaning: 'Company asked a question or made a request', color: '#b07a1f' },
  Junk: { meaning: 'Subscriptions, newsletters, passwords, verification codes, keys', color: '#7b8178' },
  'Needs Attention': { meaning: 'Application is not complete', color: '#8458a6' },
  Other: { meaning: 'Cannot decide', color: '#4f8a95' }
}

/** When an email fits several tags, the earlier tag wins. */
export const TAG_PRECEDENCE: readonly Tag[] = [
  'Rejected',
  'Meeting',
  'Questions',
  'Needs Attention',
  'Applied',
  'Junk',
  'Other'
]

/** Tags that usually need the user to do something. */
export const ACTION_TAGS: readonly Tag[] = ['Meeting', 'Questions', 'Needs Attention']

export const PROVIDER_PREFIX = 'AI/'

/** Name of the Gmail label / Outlook category for a tag. */
export function providerLabel(tag: Tag): string {
  return PROVIDER_PREFIX + tag
}

export function isTag(value: unknown): value is Tag {
  return typeof value === 'string' && (TAGS as readonly string[]).includes(value)
}

/** Case-insensitive lookup, so "needs attention" or "junk" from a model still maps. */
export function normalizeTag(value: unknown): Tag | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return TAGS.find((t) => t.toLowerCase() === v) ?? null
}

export function tagDefinitionsText(): string {
  return TAGS.map((t) => `- ${t}: ${TAG_INFO[t].meaning}`).join('\n')
}
