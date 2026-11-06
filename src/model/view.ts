import { neglectInfo, taskAvailability, urgencyLevel, type UnavailableReason, type UrgencyLevel } from './attention'
import { classify, isTerminal, priorityRank } from './classify'
import { parseDate } from './dates'
import type { ClassifyContext, MatrixFilter, MatrixTask, SortMode, QuadrantId } from './types'

// ── 필터 ────────────────────────────────────────────────────────────

export function makeDefaultFilter(): MatrixFilter {
  return { text: '', types: [], showCompleted: false, showArchived: false, showAgent: true }
}

export function isDefaultFilter(f: MatrixFilter): boolean {
  return f.text === '' && f.types.length === 0 && !f.showCompleted && !f.showArchived && f.showAgent
}

export function matchesFilter(t: MatrixTask, f: MatrixFilter, ctx: ClassifyContext): boolean {
  if (!f.showArchived && t.archived) return false
  if (!f.showCompleted && isTerminal(t.status, ctx.statuses)) return false
  if (!f.showAgent && t.byAgent) return false
  if (f.types.length > 0 && !f.types.includes(t.type)) return false
  const text = f.text.trim().toLocaleLowerCase()
  if (text) {
    const haystack = [t.title, t.displayKey, t.type, ...t.tags, ...t.assignees].join(' ').toLocaleLowerCase()
    if (!haystack.includes(text)) return false
  }
  return true
}

// ── 정렬 ────────────────────────────────────────────────────────────

/** 원본 배열을 변형하지 않는다. */
export function sortCards(tasks: readonly MatrixTask[], mode: SortMode, ctx: ClassifyContext): MatrixTask[] {
  const byTitle = (a: MatrixTask, b: MatrixTask) => a.title.localeCompare(b.title)
  const byPriority = (a: MatrixTask, b: MatrixTask) => {
    const ra = priorityRank(a.priority, ctx.priorities)
    const rb = priorityRank(b.priority, ctx.priorities)
    return (ra < 0 ? Number.MAX_SAFE_INTEGER : ra) - (rb < 0 ? Number.MAX_SAFE_INTEGER : rb)
  }
  const byDue = (a: MatrixTask, b: MatrixTask) => {
    const da = parseDate(a.due)
    const db = parseDate(b.due)
    if (da === null && db === null) return 0
    if (da === null) return 1
    if (db === null) return -1
    return da - db
  }
  const chains: Record<SortMode, Array<(a: MatrixTask, b: MatrixTask) => number>> = {
    due: [byDue, byPriority, byTitle],
    priority: [byPriority, byDue, byTitle],
    title: [byTitle],
    updated: [(a, b) => b.mtime - a.mtime, byTitle]
  }
  const chain = chains[mode]
  return [...tasks].sort((a, b) => {
    for (const cmp of chain) {
      const r = cmp(a, b)
      if (r !== 0) return r
    }
    return 0
  })
}

// ── 변화 감지 ───────────────────────────────────────────────────────

export interface TaskStateSnapshot {
  quadrant: QuadrantId
  availability: UnavailableReason | null
  urgency: UrgencyLevel
  priority: string
  neglected: boolean
}

export type TransitionReasonKind = 'quadrant' | 'availability' | 'urgency' | 'priority' | 'neglected'

export interface TransitionReason {
  kind: TransitionReasonKind
  before: string
  after: string
}

export interface TaskTransition {
  taskId: string
  title: string
  detectedAt: number
  reasons: TransitionReason[]
}

export function snapshotTask(
  task: MatrixTask,
  ctx: ClassifyContext,
  neglectedAfterDays: number,
  nowMs: number
): TaskStateSnapshot {
  return {
    quadrant: classify(task, ctx),
    availability: taskAvailability(task, ctx).reason,
    urgency: urgencyLevel(task, ctx),
    priority: task.priority,
    neglected: neglectInfo(task, ctx, neglectedAfterDays, nowMs).neglected
  }
}

/** 최초 스캔은 기준선만 만들며, 이전 스냅샷이 있는 작업만 변화로 보고한다. */
export function scanTaskTransitions(
  tasks: readonly MatrixTask[],
  previous: Readonly<Record<string, TaskStateSnapshot>>,
  ctx: ClassifyContext,
  neglectedAfterDays: number,
  nowMs: number
): { snapshot: Record<string, TaskStateSnapshot>; transitions: TaskTransition[] } {
  const snapshot: Record<string, TaskStateSnapshot> = {}
  const transitions: TaskTransition[] = []
  for (const task of tasks) {
    const next = snapshotTask(task, ctx, neglectedAfterDays, nowMs)
    snapshot[task.id] = next
    const before = previous[task.id]
    if (!before) continue
    const reasons = compareSnapshots(before, next)
    if (reasons.length > 0) transitions.push({ taskId: task.id, title: task.title, detectedAt: nowMs, reasons })
  }
  return { snapshot, transitions }
}

export function compareSnapshots(before: TaskStateSnapshot, after: TaskStateSnapshot): TransitionReason[] {
  const reasons: TransitionReason[] = []
  if (before.quadrant !== after.quadrant) reasons.push({ kind: 'quadrant', before: before.quadrant, after: after.quadrant })
  if (before.availability !== after.availability) {
    reasons.push({
      kind: 'availability',
      before: before.availability ?? 'available',
      after: after.availability ?? 'available'
    })
  }
  if (before.urgency !== after.urgency) reasons.push({ kind: 'urgency', before: before.urgency, after: after.urgency })
  if (before.priority !== after.priority) reasons.push({ kind: 'priority', before: before.priority, after: after.priority })
  if (!before.neglected && after.neglected) reasons.push({ kind: 'neglected', before: 'false', after: 'true' })
  return reasons
}

/** 같은 작업의 새 변화는 이전 항목을 대체한다. */
export function mergePendingTransitions(
  pending: readonly TaskTransition[],
  incoming: readonly TaskTransition[],
  maxItems = 100
): TaskTransition[] {
  const byId = new Map(pending.map((item) => [item.taskId, item]))
  for (const item of incoming) byId.set(item.taskId, item)
  return [...byId.values()].sort((a, b) => b.detectedAt - a.detectedAt).slice(0, Math.max(1, maxItems))
}
