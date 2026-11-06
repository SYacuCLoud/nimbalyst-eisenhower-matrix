import type { NotUrgentStrategy, UrgentDueStrategy } from './model/planMove'
import type { CardDensity, MatrixFilter, QuadrantId, SortMode } from './model/types'
import { makeDefaultFilter, type TaskStateSnapshot, type TaskTransition } from './model/view'

export interface EisenSettings {
  // 분류 기준
  /** 매트릭스에서 뺄 트래커 타입. 비어 있으면 놓을 수 있는 타입 전부(새로 만든 타입도 자동 포함). */
  excludedTypes: string[]
  urgencyWindowDays: number
  importantThresholdId: string
  separateUnavailableTasks: boolean
  showUrgencyLevels: boolean
  detectNeglectedTasks: boolean
  neglectedAfterDays: number

  // 표시
  maxCardsPerQuadrant: number
  sortMode: SortMode
  filter: MatrixFilter
  collapsedQuadrants: QuadrantId[]
  cardDensity: CardDensity

  // 이동 동작
  confirmOnDrop: boolean
  urgentDueStrategy: UrgentDueStrategy
  notUrgentStrategy: NotUrgentStrategy
  notUrgentPaddingDays: number
  keepStartBeforeDue: boolean

  // 변화 알림
  showTransitionBriefing: boolean
  transitionSnapshot: Record<string, TaskStateSnapshot>
  pendingTransitions: TaskTransition[]
}

export const DEFAULT_SETTINGS: EisenSettings = {
  excludedTypes: [],
  urgencyWindowDays: 3,
  importantThresholdId: 'high',
  separateUnavailableTasks: true,
  showUrgencyLevels: true,
  detectNeglectedTasks: true,
  neglectedAfterDays: 14,

  maxCardsPerQuadrant: 200,
  sortMode: 'due',
  filter: makeDefaultFilter(),
  collapsedQuadrants: [],
  cardDensity: 'default',

  confirmOnDrop: true,
  urgentDueStrategy: 'tomorrow',
  notUrgentStrategy: 'push',
  notUrgentPaddingDays: 4,
  keepStartBeforeDue: true,

  showTransitionBriefing: true,
  transitionSnapshot: {},
  pendingTransitions: []
}

export const SETTINGS_KEY = 'settings'

/** 저장된 값을 신뢰하지 않고 기본값 위에 정상 값만 얹는다. */
export function hydrateSettings(saved: unknown): EisenSettings {
  const s = (saved ?? {}) as Partial<EisenSettings>
  const out: EisenSettings = {
    ...DEFAULT_SETTINGS,
    ...s,
    filter: { ...makeDefaultFilter(), ...(s.filter ?? {}) },
    collapsedQuadrants: Array.isArray(s.collapsedQuadrants) ? [...s.collapsedQuadrants] : [],
    excludedTypes: Array.isArray(s.excludedTypes) ? s.excludedTypes.filter((t) => typeof t === 'string') : [],
    transitionSnapshot: isRecord(s.transitionSnapshot) ? { ...s.transitionSnapshot } : {},
    pendingTransitions: Array.isArray(s.pendingTransitions)
      ? s.pendingTransitions.filter(isTaskTransition).slice(0, 100)
      : []
  }
  if (!Array.isArray(out.filter.types)) out.filter.types = []

  out.urgencyWindowDays = clampInt(out.urgencyWindowDays, 1, 14, DEFAULT_SETTINGS.urgencyWindowDays)
  out.neglectedAfterDays = clampInt(out.neglectedAfterDays, 3, 90, DEFAULT_SETTINGS.neglectedAfterDays)
  out.notUrgentPaddingDays = clampInt(out.notUrgentPaddingDays, 1, 30, DEFAULT_SETTINGS.notUrgentPaddingDays)
  out.maxCardsPerQuadrant = clampInt(out.maxCardsPerQuadrant, 20, 1000, DEFAULT_SETTINGS.maxCardsPerQuadrant)

  if (typeof out.importantThresholdId !== 'string' || !out.importantThresholdId) {
    out.importantThresholdId = DEFAULT_SETTINGS.importantThresholdId
  }
  if (!['due', 'priority', 'title', 'updated'].includes(out.sortMode)) out.sortMode = DEFAULT_SETTINGS.sortMode
  if (!['compact', 'default', 'detailed'].includes(out.cardDensity)) out.cardDensity = DEFAULT_SETTINGS.cardDensity
  if (!['today', 'tomorrow', 'windowEdge'].includes(out.urgentDueStrategy)) {
    out.urgentDueStrategy = DEFAULT_SETTINGS.urgentDueStrategy
  }
  if (!['push', 'clear'].includes(out.notUrgentStrategy)) out.notUrgentStrategy = DEFAULT_SETTINGS.notUrgentStrategy
  return out
}

function isRecord(v: unknown): v is Record<string, TaskStateSnapshot> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isTaskTransition(v: unknown): v is TaskTransition {
  if (v === null || typeof v !== 'object') return false
  const item = v as Partial<TaskTransition>
  return (
    typeof item.taskId === 'string' &&
    typeof item.title === 'string' &&
    typeof item.detectedAt === 'number' &&
    Array.isArray(item.reasons)
  )
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  return Math.min(max, Math.max(min, n))
}
