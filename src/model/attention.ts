import { diffDays } from './dates'
import { isImportant, isTerminal } from './classify'
import type { ClassifyContext, MatrixTask } from './types'

export type UnavailableReason = 'blocked-status' | 'blocked-dependency' | 'future-start'
export type UrgencyLevel = 'none' | 'soon' | 'today' | 'overdue'

export interface TaskAvailability {
  available: boolean
  reason: UnavailableReason | null
}

/** 차단 상태, 미완료 선행 작업(dependsOn), 미래 시작일을 실행 불가로 본다. */
export function taskAvailability(task: MatrixTask, ctx: ClassifyContext): TaskAvailability {
  if (isTerminal(task.status, ctx.statuses)) return { available: true, reason: null }

  const status = ctx.statuses.find((item) => item.id === task.status)
  const statusText = `${task.status} ${status?.label ?? ''}`.toLocaleLowerCase()
  if (/\bblocked?\b|차단/.test(statusText)) {
    return { available: false, reason: 'blocked-status' }
  }

  if (ctx.blockedIds?.has(task.id)) {
    return { available: false, reason: 'blocked-dependency' }
  }

  if (task.start) {
    const days = diffDays(ctx.today, task.start)
    if (days !== null && days > 0) return { available: false, reason: 'future-start' }
  }

  return { available: true, reason: null }
}

/** 긴급 분면 안에서도 기한 초과·오늘·임박을 구분한다. */
export function urgencyLevel(task: MatrixTask, ctx: ClassifyContext): UrgencyLevel {
  if (isTerminal(task.status, ctx.statuses) || !task.due) return 'none'
  const days = diffDays(ctx.today, task.due)
  if (days === null || days >= ctx.urgencyWindowDays) return 'none'
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  return 'soon'
}

export interface NeglectInfo {
  neglected: boolean
  ageDays: number
  missingDue: boolean
}

/** 중요하고 미완료인 작업이 N일 이상 수정되지 않았을 때만 방치로 본다. */
export function neglectInfo(
  task: MatrixTask,
  ctx: ClassifyContext,
  thresholdDays: number,
  nowMs: number
): NeglectInfo {
  if (
    !isImportant(task, ctx) ||
    isTerminal(task.status, ctx.statuses) ||
    !Number.isFinite(task.mtime) ||
    task.mtime <= 0
  ) {
    return { neglected: false, ageDays: 0, missingDue: false }
  }

  const ageDays = Math.max(0, Math.floor((nowMs - task.mtime) / 86_400_000))
  return {
    neglected: ageDays >= Math.max(1, thresholdDays),
    ageDays,
    missingDue: !task.due
  }
}

/** 미완료 선행 작업이 하나라도 있는 항목 id 집합. 목록에 없는 선행 작업은 무시한다. */
export function computeBlockedIds(
  tasks: readonly MatrixTask[],
  ctx: Pick<ClassifyContext, 'statuses'>
): Set<string> {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const out = new Set<string>()
  for (const t of tasks) {
    if (isTerminal(t.status, ctx.statuses)) continue
    const blocked = t.dependsOn.some((depId) => {
      const dep = byId.get(depId)
      return dep !== undefined && !isTerminal(dep.status, ctx.statuses)
    })
    if (blocked) out.add(t.id)
  }
  return out
}
