import { describe, expect, it } from 'vitest'
import { computeBlockedIds, taskAvailability, urgencyLevel } from '../src/model/attention'
import { classify, importantIdsForThreshold, unreachableReason } from '../src/model/classify'
import { applyPlanInMemory, invertPlan, planDueSet, planQuadrantMove, type MoveOptions } from '../src/model/planMove'
import { QUADRANT_ORDER, type ClassifyContext, type MatrixTask, type PriorityConfig, type StatusConfig } from '../src/model/types'
import { makeDefaultFilter, matchesFilter, mergePendingTransitions, scanTaskTransitions, sortCards } from '../src/model/view'
import { planToUpdates, toMatrixTask } from '../src/bridge/trackerBridge'
import { hydrateSettings } from '../src/settings'

const priorities: PriorityConfig[] = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' }
]

const statuses: StatusConfig[] = [
  { id: 'to-do', label: 'To Do', category: 'unstarted', complete: false },
  { id: 'in-progress', label: 'In Progress', category: 'started', complete: false },
  { id: 'blocked', label: 'Blocked', category: 'started', complete: false },
  { id: 'done', label: 'Done', category: 'done', complete: true },
  { id: 'wont-do', label: "Won't Do", category: 'cancelled', complete: true }
]

const TODAY = '2026-11-03'

function ctxOf(window = 3, threshold = 'high'): ClassifyContext {
  return { today: TODAY, urgencyWindowDays: window, importantIds: importantIdsForThreshold(priorities, threshold), statuses, priorities }
}

function task(over: Partial<MatrixTask> = {}): MatrixTask {
  return {
    id: 'tsk_1',
    displayKey: '',
    title: 'T',
    type: 'task',
    status: 'to-do',
    priority: 'medium',
    start: '',
    due: '',
    completed: '',
    tags: [],
    assignees: [],
    archived: false,
    byAgent: false,
    documentPath: '',
    fileBacked: false,
    mtime: Date.parse('2026-11-01T00:00:00Z'),
    dependsOn: [],
    fields: { due: 'dueDate', start: 'startDate', priority: 'priority' },
    ...over
  }
}

const opts: MoveOptions = {
  urgentDueStrategy: 'tomorrow',
  notUrgentStrategy: 'push',
  notUrgentPaddingDays: 4,
  importantThresholdId: 'high',
  keepStartBeforeDue: true
}

describe('classify', () => {
  it('긴급은 남은 일수 < N, 중요는 임계값 이상', () => {
    const ctx = ctxOf()
    expect(classify(task({ due: '2026-11-05', priority: 'high' }), ctx)).toBe('do')
    expect(classify(task({ due: '2026-11-06', priority: 'high' }), ctx)).toBe('plan')
    expect(classify(task({ due: '2026-11-01', priority: 'low' }), ctx)).toBe('delegate')
    expect(classify(task({ priority: 'medium' }), ctx)).toBe('drop')
  })

  it('완료 작업은 완료일 기준으로 분류한다', () => {
    const ctx = ctxOf()
    expect(classify(task({ status: 'done', due: '2026-10-01', completed: '2026-09-30', priority: 'low' }), ctx)).toBe('delegate')
    expect(classify(task({ status: 'done', due: '2026-10-30', completed: '2026-10-01', priority: 'low' }), ctx)).toBe('drop')
  })
})

describe('planQuadrantMove 왕복 불변식', () => {
  const dues = ['', '2026-10-20', TODAY, '2026-11-04', '2026-11-20']
  const prios = ['critical', 'high', 'medium', 'low', '']
  const strategies: Array<Pick<MoveOptions, 'urgentDueStrategy' | 'notUrgentStrategy'>> = [
    { urgentDueStrategy: 'today', notUrgentStrategy: 'push' },
    { urgentDueStrategy: 'tomorrow', notUrgentStrategy: 'clear' },
    { urgentDueStrategy: 'windowEdge', notUrgentStrategy: 'push' }
  ]
  for (const window of [1, 3, 7]) {
    for (const s of strategies) {
      it(`window=${window} ${s.urgentDueStrategy}/${s.notUrgentStrategy}`, () => {
        const ctx = ctxOf(window)
        for (const due of dues) {
          for (const priority of prios) {
            for (const target of QUADRANT_ORDER) {
              const t = task({ due, priority })
              const plan = planQuadrantMove(t, target, ctx, { ...opts, ...s })
              const moved = applyPlanInMemory(t, plan)
              expect(classify(moved, ctx), `${due}/${priority}→${target}`).toBe(target)
              // 되돌리면 원래 값으로 돌아간다.
              const back = applyPlanInMemory(moved, invertPlan(plan))
              expect(back.due).toBe(t.due)
              expect(back.priority).toBe(t.priority)
            }
          }
        }
      })
    }
  }

  it('완료 작업은 이동 계획이 비어 있다', () => {
    const plan = planQuadrantMove(task({ status: 'done' }), 'do', ctxOf(), opts)
    expect(plan.changes).toHaveLength(0)
  })

  it('시작일이 새 마감일보다 늦으면 함께 당긴다', () => {
    const plan = planQuadrantMove(task({ start: '2026-11-10', due: '2026-11-20', priority: 'high' }), 'do', ctxOf(), opts)
    expect(plan.changes.map((c) => c.field).sort()).toEqual(['due', 'start'])
    expect(plan.changes.find((c) => c.field === 'start')?.after).toBe('2026-11-04')
  })

  it('필요한 필드만 바꾼다', () => {
    const plan = planQuadrantMove(task({ due: '2026-11-04', priority: 'low' }), 'do', ctxOf(), opts)
    expect(plan.changes).toEqual([expect.objectContaining({ field: 'priority', after: 'high' })])
  })
})

describe('planDueSet', () => {
  it('마감일을 지우면 null 로 쓴다', () => {
    const plan = planDueSet(task({ due: '2026-11-04' }), '', ctxOf(), { keepStartBeforeDue: true })
    expect(planToUpdates(plan, task().fields)).toEqual({ dueDate: null })
  })
})

describe('attention', () => {
  it('차단 상태 · 선행 작업 · 미래 시작일', () => {
    const ctx = ctxOf()
    expect(taskAvailability(task({ status: 'blocked' }), ctx).reason).toBe('blocked-status')
    expect(taskAvailability(task({ start: '2026-11-10' }), ctx).reason).toBe('future-start')
    const a = task({ id: 'a' })
    const b = task({ id: 'b', dependsOn: ['a'] })
    const c = task({ id: 'c', dependsOn: ['missing'] })
    const blocked = computeBlockedIds([a, b, c], ctx)
    expect([...blocked]).toEqual(['b'])
    expect(taskAvailability(b, { ...ctx, blockedIds: blocked }).reason).toBe('blocked-dependency')
  })

  it('긴급도 단계', () => {
    const ctx = ctxOf()
    expect(urgencyLevel(task({ due: '2026-11-01' }), ctx)).toBe('overdue')
    expect(urgencyLevel(task({ due: TODAY }), ctx)).toBe('today')
    expect(urgencyLevel(task({ due: '2026-11-05' }), ctx)).toBe('soon')
    expect(urgencyLevel(task({ due: '2026-11-06' }), ctx)).toBe('none')
  })
})

describe('transitions', () => {
  it('첫 스캔은 기준선만, 이후 변화만 보고한다', () => {
    const ctx = ctxOf()
    const t = task({ priority: 'low' })
    const first = scanTaskTransitions([t], {}, ctx, 14, Date.now())
    expect(first.transitions).toHaveLength(0)
    const second = scanTaskTransitions([{ ...t, priority: 'high' }], first.snapshot, ctx, 14, Date.now())
    expect(second.transitions[0]?.reasons.map((r) => r.kind)).toEqual(['quadrant', 'priority'])
    expect(mergePendingTransitions(second.transitions, second.transitions)).toHaveLength(1)
  })
})

describe('sortCards', () => {
  it('마감일 없는 작업은 마지막', () => {
    const ctx = ctxOf()
    const sorted = sortCards([task({ id: 'a' }), task({ id: 'b', due: '2026-11-04' })], 'due', ctx)
    expect(sorted.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('toMatrixTask', () => {
  it('트래커 항목을 매트릭스 작업으로 바꾼다', () => {
    const t = toMatrixTask({
      id: 'tsk_x',
      type: 'task',
      title: '근로계약서 확인',
      status: 'to-do',
      priority: 'high',
      owner: '민',
      dueDate: '2026-11-04',
      updated: '2026-11-02T23:43:32.725Z',
      source: 'native',
      customFields: { startDate: '2026-11-02', dependsOn: [{ itemId: 'tsk_y' }] }
    })
    expect(t).toMatchObject({ due: '2026-11-04', start: '2026-11-02', assignees: ['민'], fileBacked: false, dependsOn: ['tsk_y'], byAgent: false })
  })

  it('createdByAgent 가 true 인 항목만 에이전트 작업이다', () => {
    expect(toMatrixTask({ id: 'a', type: 'task', createdByAgent: true }).byAgent).toBe(true)
    expect(toMatrixTask({ id: 'b', type: 'task' }).byAgent).toBe(false)
  })

  it('frontmatter 항목은 파일 기반으로 표시한다', () => {
    const t = toMatrixTask({ id: 'fm:plan:a.md', type: 'plan', source: 'frontmatter', module: 'a.md' })
    expect(t.fileBacked).toBe(true)
  })
})

describe('hydrateSettings', () => {
  it('잘못된 값은 기본값으로 되돌린다', () => {
    const s = hydrateSettings({ urgencyWindowDays: 99, sortMode: 'x', filter: { text: 'a' } })
    expect(s.urgencyWindowDays).toBe(14)
    expect(s.sortMode).toBe('due')
    expect(s.filter).toEqual({ text: 'a', types: [], showCompleted: false, showArchived: false, showAgent: true })
  })
})

describe('matchesFilter', () => {
  it('에이전트 작업 표시를 끄면 에이전트 항목이 빠진다', () => {
    const ctx = ctxOf()
    const off = { ...makeDefaultFilter(), showAgent: false }
    expect(matchesFilter(task({ byAgent: false }), off, ctx)).toBe(true)
    expect(matchesFilter(task({ byAgent: true }), off, ctx)).toBe(false)
    expect(matchesFilter(task({ byAgent: true }), makeDefaultFilter(), ctx)).toBe(true)
  })
})

describe('타입별 필드', () => {
  const bugFields = { due: null, start: null, priority: 'priority' }
  const milestoneFields = { due: 'targetDate', start: 'startDate', priority: null }

  it('마감일 필드가 없는 타입은 긴급 분면으로 갈 수 없고, 중요도만 바꾼다', () => {
    const ctx = ctxOf()
    const bug = task({ type: 'bug', priority: 'low', fields: bugFields })
    expect(unreachableReason(bug, 'do', ctx)).toBe('no-due-field')
    expect(planQuadrantMove(bug, 'do', ctx, opts).changes).toHaveLength(0)
    const plan = planQuadrantMove(bug, 'plan', ctx, opts)
    expect(classify(applyPlanInMemory(bug, plan), ctx)).toBe('plan')
    expect(planToUpdates(plan, bugFields)).toEqual({ priority: 'high' })
    expect(planDueSet(bug, TODAY, ctx, { keepStartBeforeDue: true }).changes).toHaveLength(0)
  })

  it('우선순위 필드가 없는 타입은 중요 분면으로 갈 수 없고, 마감일은 그 타입의 필드에 쓴다', () => {
    const ctx = ctxOf()
    const ms = task({ type: 'milestone', priority: '', fields: milestoneFields })
    expect(unreachableReason(ms, 'do', ctx)).toBe('no-priority-field')
    const plan = planQuadrantMove(ms, 'delegate', ctx, opts)
    expect(planToUpdates(plan, milestoneFields)).toEqual({ targetDate: '2026-11-04' })
  })

  it('목록 항목을 타입의 필드 이름으로 읽는다', () => {
    const t = toMatrixTask(
      { id: 'mst_1', type: 'milestone', title: 'M1', customFields: { targetDate: '2026-11-20' } },
      milestoneFields
    )
    expect(t.due).toBe('2026-11-20')
    expect(t.priority).toBe('')
  })
})
