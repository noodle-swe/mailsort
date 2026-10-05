import { isTag } from './tags'
import type { ListQuery } from './types'

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const flag = (v: unknown): true | undefined => (v === true ? true : undefined)

/** Whitelists and type-checks a list query that came over IPC. Unknown or mistyped fields are dropped. */
export function sanitizeQuery(q: unknown): ListQuery {
  const o = (q ?? {}) as Record<string, unknown>
  return {
    accountId: str(o.accountId),
    tag: o.tag === 'Untagged' || isTag(o.tag) ? (o.tag as ListQuery['tag']) : undefined,
    query: str(o.query)?.slice(0, 200),
    unreadOnly: o.unreadOnly === true,
    from: str(o.from)?.slice(0, 200),
    since: num(o.since),
    until: num(o.until),
    hasAttachments: flag(o.hasAttachments),
    hasInvite: flag(o.hasInvite),
    isNewsletter: flag(o.isNewsletter),
    actionOnly: flag(o.actionOnly),
    needsReview: flag(o.needsReview),
    oldestFirst: flag(o.oldestFirst),
    cursor: str(o.cursor),
    limit: num(o.limit)
  }
}
