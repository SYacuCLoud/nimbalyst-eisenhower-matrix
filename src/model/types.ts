/** 트래커 스키마의 status 옵션. `complete` 는 done/cancelled 카테고리. */
export interface StatusConfig {
  id: string
  label: string
  category: string
  complete: boolean
  color?: string
}

/** 트래커 스키마의 priority 옵션. 배열 index 0 이 최상위다. */
export interface PriorityConfig {
  id: string
  label: string
  color?: string
}

/**
 * 매트릭스가 필요로 하는 최소 작업 정보. Nimbalyst 트래커 항목에서 만든다.
 * 본문은 읽지 않는다.
 */
export interface MatrixTask {
  /** 트래커 항목 id. 모든 상태·스냅샷의 키다. */
  id: string
  /** 화면 표시용 키(issueKey / localKey). 없으면 ''. */
  displayKey: string
  title: string
  /** 트래커 타입(task, bug, feature …) */
  type: string
  status: string
  priority: string
  /** 'YYYY-MM-DD' 또는 '' */
  start: string
  /** 'YYYY-MM-DD' 또는 '' */
  due: string
  /** 완료 작업의 기준일. 트래커는 완료일을 따로 두지 않으므로 마지막 수정일을 쓴다. */
  completed: string
  tags: string[]
  assignees: string[]
  archived: boolean
  /** 트래커 `data.createdByAgent`. 님블 "via AI" 배지와 같은 값. */
  byAgent: boolean
  /** 파일 기반(frontmatter/inline) 항목이면 원본 경로 */
  documentPath: string
  /** 파일 기반 항목은 파일에 쓰고, native 항목은 트래커 저장소에 쓴다. */
  fileBacked: boolean
  mtime: number
  /** 선행 작업(dependsOn) id 목록 */
  dependsOn: string[]
  /**
   * 이 항목의 타입이 각 값을 저장하는 트래커 필드 이름. 없으면 null — 그 축은
   * 고정값(긴급하지 않음 / 중요하지 않음)이고 그 방향으로는 옮길 수 없다.
   * 예: milestone 의 마감일은 `targetDate`, bug 는 마감일 필드가 없다.
   */
  fields: TaskFieldNames
}

export interface TaskFieldNames {
  due: string | null
  start: string | null
  priority: string | null
}

export type QuadrantId = 'do' | 'plan' | 'delegate' | 'drop'

export const QUADRANT_ORDER: readonly QuadrantId[] = ['do', 'plan', 'delegate', 'drop']

export type SortMode = 'due' | 'priority' | 'title' | 'updated'

export type CardDensity = 'compact' | 'default' | 'detailed'

export interface MatrixFilter {
  text: string
  /** [] = 전체 */
  types: string[]
  showCompleted: boolean
  showArchived: boolean
  /** false 이면 에이전트가 만든 작업을 숨긴다. 기본값은 포함. */
  showAgent: boolean
}

/** 분류에 필요한 모든 것. `today` 는 주입값이라 테스트에서 고정할 수 있다. */
export interface ClassifyContext {
  /** 'YYYY-MM-DD' */
  today: string
  urgencyWindowDays: number
  importantIds: ReadonlySet<string>
  statuses: readonly StatusConfig[]
  priorities: readonly PriorityConfig[]
  /** 미완료 선행 작업이 있는 항목 id. */
  blockedIds?: ReadonlySet<string>
}

export type WritableField = 'due' | 'priority' | 'start'

export interface FieldChange {
  field: WritableField
  before: string
  after: string
  reason: string
}

export interface QuadrantWritePlan {
  taskId: string
  title: string
  from: QuadrantId
  to: QuadrantId
  /** 비어 있으면 할 일이 없다. */
  changes: FieldChange[]
}
