import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PanelHostProps } from '@nimbalyst/extension-sdk'
import {
  ConflictError,
  applyPlan,
  createTask,
  deleteTask,
  detectCapabilities,
  isMatrixType,
  listTasks,
  loadSchemas,
  openTrackerItem,
  watchTrackerChanges,
  type TrackerSchemaInfo,
  type TrackerTypeInfo
} from '../bridge/trackerBridge'
import { computeBlockedIds, taskAvailability, urgencyLevel } from '../model/attention'
import {
  canMoveToQuadrant,
  classify,
  importantIdsForThreshold,
  isImportantQuadrant,
  isUrgentQuadrant,
  priorityRank,
  unreachableReason
} from '../model/classify'
import { addDays, todayString } from '../model/dates'
import { invertPlan, planDueSet, planQuadrantMove, quickDueTarget, type QuickDueKind } from '../model/planMove'
import { QUADRANT_ORDER, type ClassifyContext, type MatrixTask, type QuadrantId, type QuadrantWritePlan } from '../model/types'
import { isDefaultFilter, makeDefaultFilter, matchesFilter, mergePendingTransitions, scanTaskTransitions, sortCards } from '../model/view'
import { SETTINGS_KEY, hydrateSettings, type EisenSettings } from '../settings'
import {
  ConfirmDeleteDialog,
  ConfirmMoveDialog,
  ContextMenu,
  CreateTaskDialog,
  Icon,
  Quadrant,
  TaskCard,
  priorityLabel,
  type MenuState
} from './components'
import { SettingsView } from './SettingsView'
import { KO } from './strings'

interface UndoEntry {
  plan: QuadrantWritePlan
  label: string
}

interface PendingConfirm {
  task: MatrixTask
  plan: QuadrantWritePlan
  kind: 'move' | 'due'
}

interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
  action?: { label: string; run(): void }
}

const EMPTY_SCHEMA: TrackerSchemaInfo = { types: [], statuses: [], priorities: [] }

export function MatrixPanel({ host }: PanelHostProps) {
  const [settings, setSettings] = useState<EisenSettings>(() => hydrateSettings(host.storage.get(SETTINGS_KEY)))
  const [schema, setSchema] = useState<TrackerSchemaInfo>(EMPTY_SCHEMA)
  const [tasks, setTasks] = useState<MatrixTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [today, setToday] = useState(() => todayString())
  const [view, setView] = useState<'matrix' | 'settings'>('matrix')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [createFor, setCreateFor] = useState<QuadrantId | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MatrixTask | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<QuadrantId | null>(null)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [toast, setToast] = useState<Toast | null>(null)
  const [busy, setBusy] = useState(false)
  const caps = useMemo(detectCapabilities, [])
  /** 이 패널이 직접 바꾼 항목. 다음 변화 감지에서 제외한다. */
  const selfChanged = useRef(new Set<string>())
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // 토스트의 되돌리기 버튼처럼 나중에 불리는 콜백이 최신 값을 보도록 ref 로도 둔다.
  const undoRef = useRef(undoStack)
  undoRef.current = undoStack
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  // ── 설정 저장 ─────────────────────────────────────────────────────
  const patchSettings = useCallback(
    (patch: Partial<EisenSettings>) => {
      setSettings((prev) => {
        const next = hydrateSettings({ ...prev, ...patch })
        void host.storage.set(SETTINGS_KEY, next)
        return next
      })
    },
    [host]
  )

  const showToast = useCallback((text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) => {
    setToast({ id: Date.now() + Math.random(), text, tone, action })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), toast.action ? 6000 : 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  // ── 데이터 로드 ───────────────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      // 타입마다 필드 이름이 다르므로 스키마를 먼저 읽는다.
      const nextSchema = await loadSchemas()
      const nextTasks = await listTasks(host, nextSchema)
      setSchema(nextSchema)
      setTasks(nextTasks)
      setToday(todayString())
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoaded(true)
    }
  }, [host])

  useEffect(() => {
    void reload()
    let timer: number | undefined
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void reload(), 300)
    }
    const offChanges = watchTrackerChanges(schedule)
    window.addEventListener('focus', schedule)
    // 자정을 넘기면 긴급도가 바뀌므로 주기적으로 다시 계산한다.
    const tick = window.setInterval(() => setToday(todayString()), 60_000)
    // 변경 이벤트를 받을 수 없는 환경에서는 주기적으로 다시 읽는다.
    const poll = caps.live ? undefined : window.setInterval(schedule, 15_000)
    return () => {
      offChanges()
      window.removeEventListener('focus', schedule)
      window.clearTimeout(timer)
      window.clearInterval(tick)
      window.clearInterval(poll)
    }
  }, [reload, caps.live])

  // ── 분류 컨텍스트 ─────────────────────────────────────────────────
  const priorities = schema.priorities
  const ctx: ClassifyContext = useMemo(() => {
    const base = {
      today,
      urgencyWindowDays: settings.urgencyWindowDays,
      importantIds: importantIdsForThreshold(priorities, settings.importantThresholdId),
      statuses: schema.statuses,
      priorities
    }
    return { ...base, blockedIds: computeBlockedIds(tasks, base) }
  }, [today, settings.urgencyWindowDays, settings.importantThresholdId, schema.statuses, priorities, tasks])

  const typeMap = useMemo(() => new Map(schema.types.map((t) => [t.type, t])), [schema.types])

  /** 마감일이나 우선순위 중 하나라도 가진 타입은 매트릭스에 놓을 수 있다. */
  const matrixTypes = useMemo(() => schema.types.filter(isMatrixType), [schema.types])
  /** 그중 설정에서 빼지 않은 타입. */
  // 배열은 저장할 때마다 새로 만들어지므로 내용 키로 비교한다(무한 루프 방지).
  const excludedKey = settings.excludedTypes.join('\n')
  const eligibleTypes = useMemo(
    () => matrixTypes.filter((t) => !settings.excludedTypes.includes(t.type)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matrixTypes, excludedKey]
  )
  const matrixTasks = useMemo(() => {
    // 스키마를 못 읽었으면 전부 보여 준다.
    if (schema.types.length === 0) return tasks
    const allowed = new Set(eligibleTypes.map((t) => t.type))
    return tasks.filter((t) => allowed.has(t.type))
  }, [tasks, eligibleTypes, schema.types.length])

  // ── 변화 감지 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded || schema.statuses.length === 0) return
    const s = settingsRef.current
    const { snapshot, transitions } = scanTaskTransitions(matrixTasks, s.transitionSnapshot, ctx, s.neglectedAfterDays, Date.now())
    const incoming = transitions.filter((t) => !selfChanged.current.has(t.taskId))
    selfChanged.current.clear()
    const pending = s.showTransitionBriefing ? mergePendingTransitions(s.pendingTransitions, incoming) : []
    patchSettings({ transitionSnapshot: snapshot, pendingTransitions: pending })
    if (s.showTransitionBriefing && incoming.length > 0) showToast(KO.notice.transitions(incoming.length))
    // ctx 는 tasks 와 함께 바뀌므로 matrixTasks 만 의존한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixTasks, loaded])

  // ── 분면 배치 ─────────────────────────────────────────────────────
  const visible = useMemo(
    () => matrixTasks.filter((t) => matchesFilter(t, settings.filter, ctx)),
    [matrixTasks, settings.filter, ctx]
  )

  const layout = useMemo(() => {
    const buckets: Record<QuadrantId, MatrixTask[]> = { do: [], plan: [], delegate: [], drop: [] }
    const unavailable: MatrixTask[] = []
    for (const t of visible) {
      if (settings.separateUnavailableTasks && !taskAvailability(t, ctx).available) unavailable.push(t)
      else buckets[classify(t, ctx)].push(t)
    }
    const sorted = {} as Record<QuadrantId, MatrixTask[]>
    for (const q of QUADRANT_ORDER) sorted[q] = sortCards(buckets[q], settings.sortMode, ctx)
    return { buckets: sorted, unavailable: sortCards(unavailable, settings.sortMode, ctx) }
  }, [visible, ctx, settings.separateUnavailableTasks, settings.sortMode])

  // 거터 배지: 즉시 실행 분면 카드 수. 기한 초과가 있으면 경고색.
  useEffect(() => {
    const doCards = layout.buckets.do
    const overdue = doCards.some((t) => urgencyLevel(t, ctx) === 'overdue')
    host.setGutterBadge(doCards.length > 0 ? doCards.length : null, { tone: overdue ? 'warning' : 'default' })
  }, [layout, ctx, host])

  // ── 쓰기 ──────────────────────────────────────────────────────────
  const commit = useCallback(
    async (task: MatrixTask, plan: QuadrantWritePlan, label: string, options: { recordUndo?: boolean } = {}) => {
      if (plan.changes.length === 0) {
        showToast(KO.notice.noChange)
        return false
      }
      setBusy(true)
      try {
        selfChanged.current.add(task.id)
        await applyPlan(host, schema, task, plan)
        if (options.recordUndo !== false) setUndoStack((s) => [...s.slice(-19), { plan, label }])
        await reload()
        return true
      } catch (err) {
        selfChanged.current.delete(task.id)
        const msg = err instanceof Error ? err.message : String(err)
        showToast(err instanceof ConflictError ? msg : KO.notice.error(msg), 'error')
        if (err instanceof ConflictError) await reload()
        return false
      } finally {
        setBusy(false)
      }
    },
    [host, schema, reload, showToast]
  )

  const undo = useCallback(async () => {
    const stack = undoRef.current
    const last = stack[stack.length - 1]
    if (!last) return
    const task = tasksRef.current.find((t) => t.id === last.plan.taskId)
    if (!task) return
    const ok = await commit(task, invertPlan(last.plan), KO.menu.undo, { recordUndo: false })
    if (ok) {
      setUndoStack((s) => s.filter((e) => e !== last))
      showToast(KO.notice.undone)
    }
  }, [commit, showToast])

  const notifyApplied = useCallback(
    (plan: QuadrantWritePlan, kind: 'move' | 'due') => {
      showToast(kind === 'move' ? KO.notice.moved(KO.quadrant[plan.to].subtitle) : KO.notice.dueUpdated, 'info', {
        label: KO.menu.undo,
        run: () => void undo()
      })
    },
    [showToast, undo]
  )

  const requestPlan = useCallback(
    async (task: MatrixTask, plan: QuadrantWritePlan, kind: 'move' | 'due') => {
      if (plan.changes.length === 0) {
        showToast(KO.notice.noChange)
        return
      }
      if (settings.confirmOnDrop) {
        setConfirm({ task, plan, kind })
        return
      }
      if (await commit(task, plan, kind)) notifyApplied(plan, kind)
    },
    [settings.confirmOnDrop, commit, notifyApplied, showToast]
  )

  const moveOptions = useMemo(
    () => ({
      urgentDueStrategy: settings.urgentDueStrategy,
      notUrgentStrategy: settings.notUrgentStrategy,
      notUrgentPaddingDays: settings.notUrgentPaddingDays,
      importantThresholdId: settings.importantThresholdId,
      keepStartBeforeDue: settings.keepStartBeforeDue
    }),
    [settings]
  )

  const requestMove = useCallback(
    (task: MatrixTask, target: QuadrantId) => {
      if (!caps.update || busy) return
      if (!canMoveToQuadrant(task, ctx)) {
        showToast(KO.card.locked, 'error')
        return
      }
      if (classify(task, ctx) === target && taskAvailability(task, ctx).available) return
      const unreachable = unreachableReason(task, target, ctx)
      if (unreachable) {
        const typeName = typeMap.get(task.type)?.displayName ?? task.type
        showToast(unreachable === 'no-due-field' ? KO.notice.noDueField(typeName) : KO.notice.noPriorityField(typeName), 'error')
        return
      }
      void requestPlan(task, planQuadrantMove(task, target, ctx, moveOptions), 'move')
    },
    [caps.update, busy, ctx, moveOptions, requestPlan, showToast, typeMap]
  )

  const requestQuickDue = useCallback(
    (task: MatrixTask, kind: QuickDueKind) => {
      const plan = planDueSet(task, quickDueTarget(kind, task, ctx.today), ctx, { keepStartBeforeDue: settings.keepStartBeforeDue })
      void requestPlan(task, plan, 'due')
    },
    [ctx, settings.keepStartBeforeDue, requestPlan]
  )

  // ── 생성 ──────────────────────────────────────────────────────────
  const creatableTypes = useMemo(() => eligibleTypes.filter((t) => t.creatable), [eligibleTypes])

  const createDefaults = useCallback(
    (q: QuadrantId) => {
      let thresholdIdx = priorityRank(settings.importantThresholdId, priorities)
      if (thresholdIdx < 0) thresholdIdx = Math.min(1, priorities.length - 1)
      const priority = isImportantQuadrant(q)
        ? (priorities[thresholdIdx]?.id ?? '')
        : (priorities[thresholdIdx + 1]?.id ?? priorities[priorities.length - 1]?.id ?? '')
      const urgentOffset = Math.min(
        settings.urgencyWindowDays - 1,
        settings.urgentDueStrategy === 'today' ? 0 : settings.urgentDueStrategy === 'tomorrow' ? 1 : settings.urgencyWindowDays - 1
      )
      const due = isUrgentQuadrant(q)
        ? addDays(today, Math.max(0, urgentOffset))
        : settings.notUrgentStrategy === 'push'
          ? addDays(today, settings.urgencyWindowDays + settings.notUrgentPaddingDays)
          : ''
      return { priority, due }
    },
    [settings, priorities, today]
  )

  const handleCreate = useCallback(
    async (input: { type: TrackerTypeInfo; title: string; priority: string; due: string }) => {
      try {
        await createTask(host, input)
        setCreateFor(null)
        showToast(KO.notice.created)
        await reload()
      } catch (err) {
        showToast(KO.notice.error(err instanceof Error ? err.message : String(err)), 'error')
      }
    },
    [host, reload, showToast]
  )

  /** 빠른 추가는 task 타입(없으면 첫 생성 가능 타입)에 분면 기본값을 채워 바로 만든다. */
  const quickAddType = useMemo(
    () => creatableTypes.find((t) => t.type === 'task') ?? creatableTypes[0],
    [creatableTypes]
  )

  const handleQuickAdd = useCallback(
    async (q: QuadrantId, title: string) => {
      if (!quickAddType) return false
      const { priority, due } = createDefaults(q)
      try {
        await createTask(host, { type: quickAddType, title, priority, due })
        showToast(KO.notice.quickCreated(title, KO.quadrant[q].subtitle))
        await reload()
        return true
      } catch (err) {
        showToast(KO.notice.error(err instanceof Error ? err.message : String(err)), 'error')
        return false
      }
    },
    [quickAddType, createDefaults, host, reload, showToast]
  )

  const handleDelete = useCallback(
    async (task: MatrixTask) => {
      setDeleteTarget(null)
      try {
        await deleteTask(task)
        setUndoStack((s) => s.filter((e) => e.plan.taskId !== task.id))
        showToast(KO.notice.deleted)
        await reload()
      } catch (err) {
        showToast(KO.notice.error(err instanceof Error ? err.message : String(err)), 'error')
      }
    },
    [reload, showToast]
  )

  // ── 렌더 ──────────────────────────────────────────────────────────
  const openTask = useCallback((task: MatrixTask) => openTrackerItem(task.id), [])
  const neglectDays = settings.detectNeglectedTasks ? settings.neglectedAfterDays : null
  const canDrag = (t: MatrixTask) => caps.update && !busy && canMoveToQuadrant(t, ctx)

  const renderCard = (t: MatrixTask, showQuadrant = false) => (
    <TaskCard
      key={t.id}
      task={t}
      ctx={ctx}
      density={settings.cardDensity}
      typeInfo={typeMap.get(t.type)}
      showUrgency={settings.showUrgencyLevels}
      neglectedAfterDays={neglectDays}
      draggable={canDrag(t)}
      showQuadrant={showQuadrant}
      onOpen={openTask}
      onMenu={(task, x, y) => setMenu({ task, x, y })}
      onDragStart={(task) => setDragId(task.id)}
      onDragEnd={() => {
        setDragId(null)
        setDropTarget(null)
      }}
    />
  )

  const handleDrop = (q: QuadrantId, id: string) => {
    setDropTarget(null)
    setDragId(null)
    const task = tasks.find((t) => t.id === id)
    if (task) requestMove(task, q)
  }

  if (view === 'settings') {
    return (
      <div className="eis-root">
        <SettingsView
          settings={settings}
          priorities={priorities}
          types={matrixTypes}
          caps={caps}
          onPatch={patchSettings}
          onBack={() => setView('matrix')}
        />
      </div>
    )
  }

  const filter = settings.filter
  const setFilter = (patch: Partial<typeof filter>) => patchSettings({ filter: { ...filter, ...patch } })
  const pending = settings.showTransitionBriefing ? settings.pendingTransitions : []
  const lastUndo = undoStack[undoStack.length - 1]
  const max = settings.maxCardsPerQuadrant
  const nothingAtAll = loaded && matrixTasks.length === 0
  const nothingVisible = loaded && !nothingAtAll && visible.length === 0

  return (
    <div className={`eis-root ${dragId ? 'is-dragging' : ''}`}>
      <div className="eis-toolbar">
        <h2 className="eis-title">
          <Icon name="grid_view" /> {KO.viewTitle}
        </h2>
        <div className="eis-search">
          <Icon name="search" />
          <input
            type="search"
            value={filter.text}
            placeholder={KO.toolbar.searchPlaceholder}
            onChange={(e) => setFilter({ text: e.target.value })}
          />
        </div>
        <select
          aria-label={KO.toolbar.type}
          value={filter.types[0] ?? ''}
          onChange={(e) => setFilter({ types: e.target.value ? [e.target.value] : [] })}
        >
          <option value="">{KO.toolbar.typeAll}</option>
          {eligibleTypes.map((t) => (
            <option key={t.type} value={t.type}>
              {t.displayName}
            </option>
          ))}
        </select>
        <label className="eis-inline">
          {KO.toolbar.sort}
          <select value={settings.sortMode} onChange={(e) => patchSettings({ sortMode: e.target.value as EisenSettings['sortMode'] })}>
            {Object.entries(KO.sort).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="eis-segment" role="group" aria-label={KO.toolbar.density}>
          {(['compact', 'default', 'detailed'] as const).map((d) => (
            <button key={d} className={settings.cardDensity === d ? 'is-active' : ''} onClick={() => patchSettings({ cardDensity: d })}>
              {KO.density[d]}
            </button>
          ))}
        </div>
        <label className="eis-check">
          <input type="checkbox" checked={filter.showCompleted} onChange={(e) => setFilter({ showCompleted: e.target.checked })} />
          {KO.toolbar.showCompleted}
        </label>
        <label className="eis-check">
          <input type="checkbox" checked={filter.showArchived} onChange={(e) => setFilter({ showArchived: e.target.checked })} />
          {KO.toolbar.showArchived}
        </label>
        <label className="eis-check">
          <input type="checkbox" checked={filter.showAgent} onChange={(e) => setFilter({ showAgent: e.target.checked })} />
          {KO.toolbar.showAgent}
        </label>
        {!isDefaultFilter(filter) && (
          <button className="eis-btn is-ghost" onClick={() => patchSettings({ filter: makeDefaultFilter() })} title={KO.toolbar.filterActive}>
            <Icon name="filter_alt_off" /> {KO.toolbar.reset}
          </button>
        )}
        <span className="eis-spacer" />
        <button className="eis-icon-btn" disabled={!lastUndo || busy} onClick={() => void undo()} title={KO.toolbar.undo}>
          <Icon name="undo" />
        </button>
        <button className="eis-icon-btn" onClick={() => void reload()} title={KO.toolbar.refresh}>
          <Icon name="refresh" />
        </button>
        <button className="eis-icon-btn" onClick={() => setView('settings')} title={KO.toolbar.settings}>
          <Icon name="settings" />
        </button>
      </div>

      {!caps.update && <div className="eis-banner">{KO.banner.readOnly}</div>}
      {loadError && <div className="eis-banner is-error">{KO.notice.error(loadError)}</div>}

      {pending.length > 0 && (
        <div className="eis-briefing">
          <div className="eis-briefing-head">
            <Icon name="notifications_active" />
            <strong>{KO.briefing.title(pending.length)}</strong>
            <span className="eis-muted">{KO.briefing.subtitle}</span>
            <span className="eis-spacer" />
            <button className="eis-btn is-ghost" onClick={() => patchSettings({ pendingTransitions: [] })}>
              {KO.briefing.dismiss}
            </button>
          </div>
          <ul>
            {pending.slice(0, 5).map((tr) => (
              <li key={tr.taskId}>
                <button className="eis-link" onClick={() => openTrackerItem(tr.taskId)}>
                  {tr.title}
                </button>
                {tr.reasons.map((r) => (
                  <span key={r.kind} className="eis-chip">
                    {r.kind === 'neglected'
                      ? KO.briefing.neglected
                      : `${KO.briefing.kind[r.kind]}: ${describeValue(r.kind, r.before, priorities)} → ${describeValue(r.kind, r.after, priorities)}`}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          {pending.length > 5 && <div className="eis-muted">{KO.briefing.more(pending.length - 5)}</div>}
        </div>
      )}

      {nothingAtAll ? (
        <div className="eis-empty-all">{KO.empty.all}</div>
      ) : nothingVisible ? (
        <div className="eis-empty-all">
          {KO.empty.allFiltered}{' '}
          <button className="eis-btn" onClick={() => patchSettings({ filter: makeDefaultFilter() })}>
            {KO.empty.resetFilter}
          </button>
        </div>
      ) : null}

      <div className="eis-matrix">
        <div className="eis-axis eis-axis-corner" />
        <div className="eis-axis eis-axis-col">{KO.axis.urgent}</div>
        <div className="eis-axis eis-axis-col">{KO.axis.notUrgent}</div>
        {(
          [
            [KO.axis.important, 'do', 'plan'],
            [KO.axis.notImportant, 'delegate', 'drop']
          ] as const
        ).map(([rowLabel, ...row]) => [
          <div key={rowLabel} className="eis-axis eis-axis-row">
            <span>{rowLabel}</span>
          </div>,
          ...row.map((q) => {
            const cards = layout.buckets[q]
            return (
              <Quadrant
                key={q}
                id={q}
                count={cards.length}
                hidden={Math.max(0, cards.length - max)}
                collapsed={settings.collapsedQuadrants.includes(q)}
                canCreate={caps.create && creatableTypes.length > 0}
                dropActive={dragId !== null && dropTarget === q}
                onToggle={() =>
                  patchSettings({
                    collapsedQuadrants: settings.collapsedQuadrants.includes(q)
                      ? settings.collapsedQuadrants.filter((x) => x !== q)
                      : [...settings.collapsedQuadrants, q]
                  })
                }
                onCreate={() => setCreateFor(q)}
                onQuickAdd={caps.create && quickAddType ? (title) => handleQuickAdd(q, title) : undefined}
                onDragOver={() => setDropTarget(q)}
                onDragLeave={() => setDropTarget((cur) => (cur === q ? null : cur))}
                onDrop={(id) => handleDrop(q, id)}
              >
                {cards.slice(0, max).map((t) => renderCard(t))}
              </Quadrant>
            )
          })
        ])}
      </div>

      {settings.separateUnavailableTasks && (
        <section className="eis-unavailable">
          <header className="eis-quadrant-head">
            <Icon name="block" />
            <div className="eis-quadrant-titles">
              <span className="eis-quadrant-subtitle">{KO.unavailable.subtitle}</span>
              <span className="eis-quadrant-title">{KO.unavailable.title}</span>
            </div>
            <span className="eis-count">{layout.unavailable.length}</span>
          </header>
          <div className="eis-unavailable-body">
            {layout.unavailable.length === 0 ? (
              <div className="eis-empty">{KO.unavailable.empty}</div>
            ) : (
              layout.unavailable.slice(0, max).map((t) => renderCard(t, true))
            )}
          </div>
        </section>
      )}

      {menu && (
        <ContextMenu
          menu={menu}
          ctx={ctx}
          canWrite={caps.update && !busy}
          canDelete={caps.remove}
          canUndo={!!lastUndo}
          onMove={requestMove}
          onQuickDue={requestQuickDue}
          onOpen={openTask}
          onOpenDocument={(t) => host.openFile(t.documentPath)}
          onDelete={(t) => setDeleteTarget(t)}
          onUndo={() => void undo()}
          onClose={() => setMenu(null)}
        />
      )}

      {confirm && (
        <ConfirmMoveDialog
          plan={confirm.plan}
          kind={confirm.kind}
          priorities={priorities}
          onCancel={() => setConfirm(null)}
          onApply={async (dontAsk) => {
            const { task, plan, kind } = confirm
            setConfirm(null)
            if (dontAsk) patchSettings({ confirmOnDrop: false })
            if (await commit(task, plan, kind)) notifyApplied(plan, kind)
          }}
        />
      )}

      {createFor && (
        <CreateTaskDialog
          quadrant={createFor}
          types={creatableTypes}
          priorities={priorities}
          {...(() => {
            const d = createDefaults(createFor)
            return { defaultPriority: d.priority, defaultDue: d.due }
          })()}
          onCancel={() => setCreateFor(null)}
          onCreate={handleCreate}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteDialog task={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => void handleDelete(deleteTarget)} />
      )}

      {toast && (
        <div className={`eis-toast is-${toast.tone}`} role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="eis-btn is-ghost"
              onClick={() => {
                toast.action?.run()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function describeValue(kind: string, value: string, priorities: TrackerSchemaInfo['priorities']): string {
  if (kind === 'quadrant') return KO.quadrant[value as QuadrantId]?.subtitle ?? value
  if (kind === 'priority') return priorityLabel(value, priorities)
  return KO.briefing.value[value] ?? value
}
