import { diffDays } from './dates'
import type { ClassifyContext, MatrixTask, PriorityConfig, QuadrantId, StatusConfig } from './types'

/**
 * 순수 함수만.
 *
 * 축 정의
 *  - 긴급: 마감일이 있고, 기준일부터 N일 미만 남았거나 이미 지남.
 *          진행 중 작업의 기준일은 오늘, 완료 작업의 기준일은 완료(마지막 수정)일이다.
 *  - 중요: priority 가 팔레트 순서상 임계값 이상.
 */

export function isTerminal(status: string, statuses: readonly StatusConfig[]): boolean {
  return statuses.find((s) => s.id === status)?.complete === true
}

/** 오늘 기준 남은 일수. 마감일이 없거나 잘못됐으면 null. */
export function daysUntilDue(due: string, today: string): number | null {
  if (!due) return null
  return diffDays(today, due)
}

export function isUrgent(t: MatrixTask, ctx: ClassifyContext): boolean {
  const referenceDate = isTerminal(t.status, ctx.statuses) ? t.completed : ctx.today
  if (!referenceDate) return false
  const days = daysUntilDue(t.due, referenceDate)
  if (days === null) return false
  return days < ctx.urgencyWindowDays
}

export function isImportant(t: MatrixTask, ctx: ClassifyContext): boolean {
  return ctx.importantIds.has(t.priority)
}

export function quadrantOf(urgent: boolean, important: boolean): QuadrantId {
  if (urgent) return important ? 'do' : 'delegate'
  return important ? 'plan' : 'drop'
}

export function classify(t: MatrixTask, ctx: ClassifyContext): QuadrantId {
  return quadrantOf(isUrgent(t, ctx), isImportant(t, ctx))
}

export function isUrgentQuadrant(q: QuadrantId): boolean {
  return q === 'do' || q === 'delegate'
}

export function isImportantQuadrant(q: QuadrantId): boolean {
  return q === 'do' || q === 'plan'
}

/** 완료 작업의 과거 분류를 보존하기 위해 분면 이동은 허용하지 않는다. */
export function canMoveToQuadrant(task: MatrixTask, ctx: ClassifyContext): boolean {
  return !isTerminal(task.status, ctx.statuses)
}

export type UnreachableReason = 'no-due-field' | 'no-priority-field'

/**
 * 타입에 없는 필드를 바꿔야 하는 이동이면 그 이유를 돌려준다. 갈 수 있으면 null.
 * (예: 마감일 필드가 없는 bug 는 긴급 분면으로 옮길 수 없다.)
 */
export function unreachableReason(task: MatrixTask, target: QuadrantId, ctx: ClassifyContext): UnreachableReason | null {
  if (isUrgentQuadrant(target) !== isUrgent(task, ctx) && !task.fields.due) return 'no-due-field'
  if (isImportantQuadrant(target) !== isImportant(task, ctx) && !task.fields.priority) return 'no-priority-field'
  return null
}

/** 팔레트에서의 순위. 배열 index 가 곧 순위(0 = 최상위). 없으면 -1. */
export function priorityRank(id: string, priorities: readonly PriorityConfig[]): number {
  return priorities.findIndex((p) => p.id === id)
}

/**
 * 임계값 id 이상(=index 이하)인 priority id 집합.
 * 임계값 id 가 팔레트에 없으면 상위 두 개를 쓴다.
 */
export function importantIdsForThreshold(
  priorities: readonly PriorityConfig[],
  thresholdId: string
): Set<string> {
  if (priorities.length === 0) return new Set()
  let idx = priorityRank(thresholdId, priorities)
  if (idx < 0) idx = Math.min(1, priorities.length - 1)
  return new Set(priorities.slice(0, idx + 1).map((p) => p.id))
}
