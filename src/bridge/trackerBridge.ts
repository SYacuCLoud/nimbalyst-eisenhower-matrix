import type { PanelHost } from '@nimbalyst/extension-sdk'
import { normalizeDateField } from '../model/dates'
import type { FieldChange, MatrixTask, PriorityConfig, QuadrantWritePlan, StatusConfig, TaskFieldNames } from '../model/types'

/**
 * Nimbalyst 트래커 연동 계층.
 *
 * 확장 SDK 는 트래커 읽기(`host.data.query`)만 공개한다. 쓰기·생성·편집기 열기는
 * Nimbalyst 의 트래커 UI 가 쓰는 렌더러 IPC(`window.electronAPI`)를 그대로 쓴다.
 * 내부 경로라 앱 업데이트로 바뀔 수 있으므로, 호출 전에 존재 여부를 확인하고
 * 없으면 읽기 전용으로 동작한다.
 */

interface ElectronApiLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send?(channel: string, ...args: unknown[]): void
  on?(channel: string, cb: (...args: unknown[]) => void): (() => void) | void
  documentService?: {
    updateTrackerItem?(payload: unknown): Promise<unknown>
    updateTrackerItemInFile?(payload: unknown): Promise<unknown>
    createTrackerItem?(payload: unknown): Promise<unknown>
  }
}

function electronApi(): ElectronApiLike | null {
  const api = (window as unknown as { electronAPI?: ElectronApiLike }).electronAPI
  return api && typeof api.invoke === 'function' ? api : null
}

export interface BridgeCapabilities {
  /** 렌더러 IPC 로 목록을 읽는다. false 면 DB 읽기 폴백. */
  ipcList: boolean
  update: boolean
  create: boolean
  remove: boolean
  open: boolean
  live: boolean
}

export function detectCapabilities(): BridgeCapabilities {
  const api = electronApi()
  return {
    ipcList: !!api,
    update: typeof api?.documentService?.updateTrackerItem === 'function',
    create: typeof api?.documentService?.createTrackerItem === 'function',
    remove: !!api,
    open: true,
    live: typeof api?.on === 'function'
  }
}

// ── 스키마 ──────────────────────────────────────────────────────────

export interface TrackerTypeInfo {
  type: string
  displayName: string
  icon: string
  color: string
  idPrefix: string
  creatable: boolean
  /** 마감일·시작일·우선순위를 저장하는 필드 이름. 타입에 없으면 null. */
  fields: TaskFieldNames
  defaultStatus: string
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
}

export interface TrackerSchemaInfo {
  types: TrackerTypeInfo[]
  /** 모든 타입의 상태 합집합 */
  statuses: StatusConfig[]
  /** 대표 우선순위 팔레트. index 0 이 최상위. */
  priorities: PriorityConfig[]
}

interface RawField {
  name: string
  type?: string
  default?: unknown
  options?: Array<{ value: string; label?: string; category?: string; color?: string }>
}

interface RawModel {
  type: string
  displayName?: string
  icon?: string
  color?: string
  idPrefix?: string
  creatable?: boolean
  fields?: RawField[]
  roles?: Record<string, string>
}

const DEFAULT_PRIORITIES: PriorityConfig[] = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' }
]

const DEFAULT_STATUSES: StatusConfig[] = [
  { id: 'to-do', label: 'To Do', category: 'unstarted', complete: false },
  { id: 'in-progress', label: 'In Progress', category: 'started', complete: false },
  { id: 'blocked', label: 'Blocked', category: 'started', complete: false },
  { id: 'done', label: 'Done', category: 'done', complete: true }
]

/**
 * 역할(role)로 필드를 찾는다. 타입마다 같은 의미의 필드 이름이 다를 수 있다
 * (milestone 의 마감일은 `targetDate`). 역할 선언이 없으면 관례 이름으로 찾는다.
 */
function fieldByRole(model: RawModel, role: string, fallbackName: string): RawField | undefined {
  const name = model.roles?.[role] ?? fallbackName
  return model.fields?.find((f) => f.name === name)
}

/** 날짜 필드만 마감일·시작일로 쓴다. */
function dateFieldName(field: RawField | undefined): string | null {
  return field && (field.type === 'date' || field.type === 'datetime') ? field.name : null
}

function toTypeInfo(model: RawModel): TrackerTypeInfo {
  const statusField = fieldByRole(model, 'workflowStatus', 'status')
  const priorityField = fieldByRole(model, 'priority', 'priority')
  const dueField = fieldByRole(model, 'dueDate', 'dueDate')
  const startField = fieldByRole(model, 'startDate', 'startDate')
  const statuses: StatusConfig[] = (statusField?.options ?? []).map((o) => ({
    id: o.value,
    label: o.label ?? o.value,
    category: o.category ?? '',
    complete: o.category === 'done' || o.category === 'cancelled',
    color: o.color
  }))
  // 스키마는 낮은 우선순위부터 나열한다(low → critical). 매트릭스는 최상위가 index 0.
  const priorities: PriorityConfig[] = (priorityField?.options ?? [])
    .map((o) => ({ id: o.value, label: o.label ?? o.value, color: o.color }))
    .reverse()
  return {
    type: model.type,
    displayName: model.displayName ?? model.type,
    icon: model.icon ?? 'label',
    color: model.color ?? '',
    idPrefix: model.idPrefix ?? model.type.slice(0, 3),
    creatable: model.creatable !== false,
    fields: {
      due: dateFieldName(dueField),
      start: dateFieldName(startField),
      priority: priorityField && priorityField.type === 'select' ? priorityField.name : null
    },
    defaultStatus: typeof statusField?.default === 'string' ? statusField.default : (statuses[0]?.id ?? 'to-do'),
    statuses,
    priorities
  }
}

export async function loadSchemas(): Promise<TrackerSchemaInfo> {
  const api = electronApi()
  let models: RawModel[] = []
  if (api) {
    try {
      const raw = await api.invoke('tracker-schema:get-all')
      if (Array.isArray(raw)) models = raw as RawModel[]
    } catch {
      models = []
    }
  }
  const types = models.filter((m) => m && typeof m.type === 'string').map(toTypeInfo)

  const statusMap = new Map<string, StatusConfig>()
  for (const t of types) for (const s of t.statuses) if (!statusMap.has(s.id)) statusMap.set(s.id, s)
  const statuses = statusMap.size > 0 ? [...statusMap.values()] : DEFAULT_STATUSES

  const paletteOwner = types.find((t) => t.type === 'task' && t.priorities.length > 0) ?? types.find((t) => t.priorities.length > 0)
  const priorities = paletteOwner?.priorities ?? DEFAULT_PRIORITIES

  return { types, statuses, priorities }
}

/** 마감일이나 우선순위 중 하나라도 있어야 매트릭스에 놓을 수 있다. */
export function isMatrixType(t: TrackerTypeInfo): boolean {
  return t.fields.due !== null || t.fields.priority !== null
}

/** 스키마를 못 읽었을 때 쓰는 관례 필드 이름. */
export const DEFAULT_FIELDS: TaskFieldNames = { due: 'dueDate', start: 'startDate', priority: 'priority' }

// ── 항목 목록 ───────────────────────────────────────────────────────

interface RawItem {
  id: string
  issueKey?: string
  localKey?: string
  type: string
  title?: string
  status?: string
  priority?: string
  owner?: string
  tags?: unknown
  dueDate?: unknown
  startDate?: unknown
  updated?: unknown
  archived?: boolean
  module?: string
  source?: string
  workspace?: string
  customFields?: Record<string, unknown>
  deleted?: boolean
  createdByAgent?: boolean
}

function toStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (typeof v === 'string' && v) return v.split(',').map((x) => x.trim()).filter(Boolean)
  return []
}

function relationshipIds(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : []
  const out: string[] = []
  for (const entry of list) {
    if (typeof entry === 'string') out.push(entry)
    else if (entry && typeof entry === 'object') {
      const id = (entry as { itemId?: unknown; id?: unknown }).itemId ?? (entry as { id?: unknown }).id
      if (typeof id === 'string') out.push(id)
    }
  }
  return out
}

function toMillis(v: unknown): number {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' || typeof v === 'number') {
    const ms = new Date(v).getTime()
    return Number.isFinite(ms) ? ms : 0
  }
  return 0
}

function localDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * 트래커 항목을 매트릭스 작업으로 바꾼다. 값은 타입이 선언한 필드 이름으로 읽는다.
 * 목록 API 는 dueDate 같은 일부 필드만 최상위로 올리고 나머지는 customFields 에 둔다.
 */
export function toMatrixTask(raw: RawItem, fields: TaskFieldNames = DEFAULT_FIELDS): MatrixTask {
  const cf = raw.customFields ?? {}
  const read = (name: string | null): unknown =>
    name ? ((raw as unknown as Record<string, unknown>)[name] ?? cf[name]) : undefined
  const mtime = toMillis(raw.updated)
  const source = raw.source ?? 'native'
  const documentPath = raw.module ?? ''
  return {
    id: raw.id,
    displayKey: raw.issueKey ?? raw.localKey ?? '',
    title: raw.title?.trim() || '(제목 없음)',
    type: raw.type,
    status: raw.status ?? '',
    priority: typeof read(fields.priority) === 'string' ? (read(fields.priority) as string) : '',
    start: normalizeDateField(read(fields.start)),
    due: normalizeDateField(read(fields.due)),
    completed: localDate(mtime),
    tags: toStringList(raw.tags),
    assignees: raw.owner ? [raw.owner] : [],
    archived: raw.archived === true,
    documentPath,
    fileBacked: (source === 'frontmatter' || source === 'import' || source === 'inline') && documentPath !== '',
    mtime,
    dependsOn: relationshipIds(cf.dependsOn),
    fields,
    byAgent: raw.createdByAgent === true
  }
}

/** 타입별 필드 이름. 스키마에 없는 타입(스키마를 못 읽은 경우 포함)은 관례 이름을 쓴다. */
function fieldsResolver(schema: TrackerSchemaInfo): (type: string) => TaskFieldNames {
  const byType = new Map(schema.types.map((t) => [t.type, t.fields]))
  return (type) => byType.get(type) ?? DEFAULT_FIELDS
}

export async function listTasks(host: PanelHost, schema: TrackerSchemaInfo): Promise<MatrixTask[]> {
  const fieldsOf = fieldsResolver(schema)
  const api = electronApi()
  if (api) {
    const raw = await api.invoke('document-service:tracker-items-list')
    if (Array.isArray(raw)) {
      return (raw as RawItem[])
        .filter((r) => r && typeof r.id === 'string' && !r.deleted)
        .filter((r) => !r.workspace || samePath(r.workspace, host.workspacePath))
        .map((r) => toMatrixTask(r, fieldsOf(r.type)))
    }
  }
  return listTasksFromDatabase(host, fieldsOf)
}

/** 공개 SDK 경로. 렌더러 IPC 가 없을 때만 쓴다. */
async function listTasksFromDatabase(host: PanelHost, fieldsOf: (type: string) => TaskFieldNames): Promise<MatrixTask[]> {
  const rows = await host.data.query<{
    id: string
    issue_key: string | null
    type: string
    data: unknown
    document_path: string | null
    updated: unknown
    archived: boolean | null
    source: string | null
  }>(
    `SELECT id, issue_key, type, data, document_path, updated, archived, source
     FROM tracker_items
     WHERE workspace = $1 AND deleted_at IS NULL
     ORDER BY updated DESC NULLS LAST
     LIMIT 5000`,
    [host.workspacePath]
  )
  return rows.map((row) => {
    const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data ?? {}) as Record<string, unknown>
    const cf = (data.customFields ?? {}) as Record<string, unknown>
    return toMatrixTask(
      {
        id: row.id,
        issueKey: row.issue_key ?? undefined,
        type: row.type,
        title: data.title as string,
        status: data.status as string,
        owner: data.owner as string,
        tags: data.tags,
        updated: row.updated,
        archived: row.archived === true,
        module: row.document_path ?? undefined,
        source: row.source ?? undefined,
        // 필드 이름으로 읽을 수 있도록 data 전체를 넘긴다.
        customFields: { ...data, ...cf, dependsOn: data.dependsOn ?? cf.dependsOn },
        createdByAgent: data.createdByAgent === true
      },
      fieldsOf(row.type)
    )
  })
}

/**
 * 트래커 항목이 바뀌면 호출된다. 구독 해제 함수를 돌려준다.
 *
 * 메인 프로세스는 `tracker-items-watch` 를 보낸 창에만 로컬 변경을 알린다.
 * 트래커 화면을 한 번도 열지 않은 창은 이 요청이 없어 이벤트를 받지 못하므로
 * 직접 요청한다. 창(sender) 단위로 한 번만 등록되므로 다시 보내도 중복되지 않는다.
 */
export function watchTrackerChanges(cb: () => void): () => void {
  const api = electronApi()
  if (typeof api?.on !== 'function') return () => {}
  try {
    api.send?.('document-service:tracker-items-watch')
  } catch {
    // 구독 요청이 없어도 아래 이벤트 중 일부(팀 동기화)는 들어온다.
  }
  const offs = [
    'document-service:tracker-items-changed',
    // 팀원이 바꾼 항목은 동기화 경로로 들어온다.
    'tracker-sync:item-upserted',
    'tracker-sync:item-deleted',
    // 타입에 필드가 추가되면 그 축으로 옮길 수 있게 된다.
    'tracker-schema:changed'
  ].map((channel) => api.on!(channel, () => cb()))
  return () => offs.forEach((off) => typeof off === 'function' && off())
}

// ── 쓰기 ────────────────────────────────────────────────────────────

/** 계획을 트래커 필드 이름 기준의 수정값으로 바꾼다. 타입에 없는 필드는 쓰지 않는다. */
export function planToUpdates(plan: QuadrantWritePlan, fields: TaskFieldNames): Record<string, string | null> {
  const updates: Record<string, string | null> = {}
  for (const c of plan.changes) {
    const name = fields[c.field]
    if (name) updates[name] = c.after === '' ? null : c.after
  }
  return updates
}

export class ConflictError extends Error {}

/**
 * 계획을 적용한다. 쓰기 직전 최신 값을 다시 읽어 계획의 `before` 와 다르면
 * (다른 곳에서 동시에 수정됨) 아무것도 쓰지 않고 ConflictError 를 던진다.
 */
export async function applyPlan(
  host: PanelHost,
  schema: TrackerSchemaInfo,
  task: MatrixTask,
  plan: QuadrantWritePlan
): Promise<void> {
  if (plan.changes.length === 0) return
  const api = electronApi()
  const ds = api?.documentService
  if (!api || !ds?.updateTrackerItem) throw new Error('이 Nimbalyst 버전에서는 트래커 항목을 수정할 수 없습니다.')

  const latest = (await listTasks(host, schema)).find((t) => t.id === task.id)
  if (!latest) throw new ConflictError('항목을 찾을 수 없습니다. 삭제되었을 수 있습니다.')
  for (const c of plan.changes) {
    if (latest[c.field] !== c.before) {
      throw new ConflictError('다른 곳에서 이 항목이 수정되었습니다. 새로고침 후 다시 시도해 주세요.')
    }
  }

  const updates = planToUpdates(plan, task.fields)
  if (Object.keys(updates).length === 0) return
  const result = (task.fileBacked && ds.updateTrackerItemInFile
    ? await ds.updateTrackerItemInFile({ itemId: task.id, updates })
    : await ds.updateTrackerItem({ itemId: task.id, updates })) as { success?: boolean; error?: string } | undefined
  if (result && result.success === false) throw new Error(result.error ?? '항목 수정에 실패했습니다.')
}

export interface CreateTaskInput {
  type: TrackerTypeInfo
  title: string
  priority: string
  due: string
}

function newItemId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${prefix}_${Date.now().toString(36)}${rand}`
}

export async function createTask(host: PanelHost, input: CreateTaskInput): Promise<string> {
  const ds = electronApi()?.documentService
  if (!ds?.createTrackerItem) throw new Error('이 Nimbalyst 버전에서는 항목을 만들 수 없습니다.')
  const id = newItemId(input.type.idPrefix)
  const { fields } = input.type
  const customFields: Record<string, string> = {}
  if (input.due && fields.due) customFields[fields.due] = input.due
  // 우선순위는 관례 이름이면 최상위로, 다른 이름이면 그 필드로 쓴다. 필드가 없으면 쓰지 않는다.
  const priority = fields.priority === 'priority' ? input.priority || undefined : undefined
  if (input.priority && fields.priority && fields.priority !== 'priority') customFields[fields.priority] = input.priority
  const result = (await ds.createTrackerItem({
    id,
    type: input.type.type,
    title: input.title.trim(),
    status: input.type.defaultStatus,
    priority,
    workspace: host.workspacePath,
    customFields
  })) as { id?: string; success?: boolean; error?: string } | undefined
  if (result && result.success === false) throw new Error(result.error ?? '항목 생성에 실패했습니다.')
  return result?.id ?? id
}

export async function deleteTask(task: MatrixTask): Promise<void> {
  const api = electronApi()
  if (!api) throw new Error('이 Nimbalyst 버전에서는 항목을 삭제할 수 없습니다.')
  if (task.fileBacked) throw new Error('파일 기반 항목은 원본 문서에서 삭제해 주세요.')
  const result = (await api.invoke('document-service:tracker-item-delete', { itemId: task.id })) as
    | { success?: boolean; error?: string }
    | undefined
  if (result && result.success === false) throw new Error(result.error ?? '항목 삭제에 실패했습니다.')
}

/** Nimbalyst 트래커의 항목 상세 화면으로 이동한다. */
export function openTrackerItem(itemId: string): void {
  window.dispatchEvent(new CustomEvent('nimbalyst:navigate-tracker-item', { detail: { itemId } }))
}
