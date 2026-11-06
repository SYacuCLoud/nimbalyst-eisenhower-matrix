import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { neglectInfo, taskAvailability, urgencyLevel } from '../model/attention'
import { classify, isTerminal, unreachableReason } from '../model/classify'
import { relativeDueKo, withWeekdayKo } from '../model/dates'
import { QUICK_DUE_KINDS, type QuickDueKind } from '../model/planMove'
import type { CardDensity, ClassifyContext, MatrixTask, PriorityConfig, QuadrantId, QuadrantWritePlan } from '../model/types'
import { QUADRANT_ORDER } from '../model/types'
import type { TrackerTypeInfo } from '../bridge/trackerBridge'
import { KO } from './strings'

export function Icon({ name, className }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined eis-icon ${className ?? ''}`}>{name}</span>
}

export function priorityLabel(id: string, priorities: readonly PriorityConfig[]): string {
  return priorities.find((p) => p.id === id)?.label ?? (id || KO.confirm.emptyValue)
}

// ── 카드 ────────────────────────────────────────────────────────────

export interface CardProps {
  task: MatrixTask
  ctx: ClassifyContext
  density: CardDensity
  typeInfo?: TrackerTypeInfo
  showUrgency: boolean
  neglectedAfterDays: number | null
  draggable: boolean
  showQuadrant?: boolean
  onOpen(task: MatrixTask): void
  onMenu(task: MatrixTask, x: number, y: number): void
  onDragStart(task: MatrixTask): void
  onDragEnd(): void
}

export function TaskCard(props: CardProps) {
  const { task, ctx, density, typeInfo } = props
  const done = isTerminal(task.status, ctx.statuses)
  const status = ctx.statuses.find((s) => s.id === task.status)
  const rel = task.due ? relativeDueKo(task.due, ctx.today) : null
  const urgency = props.showUrgency ? urgencyLevel(task, ctx) : 'none'
  const availability = taskAvailability(task, ctx)
  const neglect = props.neglectedAfterDays !== null ? neglectInfo(task, ctx, props.neglectedAfterDays, Date.now()) : null
  const priorityIdx = ctx.priorities.findIndex((p) => p.id === task.priority)

  return (
    <div
      className={`eis-card eis-density-${density} ${done ? 'is-done' : ''} ${props.draggable ? 'is-draggable' : ''}`}
      draggable={props.draggable}
      role="button"
      tabIndex={0}
      aria-label={KO.card.open(task.title)}
      title={props.draggable ? undefined : done ? KO.card.locked : undefined}
      onClick={() => props.onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onOpen(task)
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          props.onMenu(task, r.left + 12, r.bottom)
          e.preventDefault()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        props.onMenu(task, e.clientX, e.clientY)
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id)
        e.dataTransfer.effectAllowed = 'move'
        props.onDragStart(task)
      }}
      onDragEnd={props.onDragEnd}
    >
      <div className="eis-card-head">
        {typeInfo && (
          <span className="eis-type" style={typeInfo.color ? { color: typeInfo.color } : undefined} title={typeInfo.displayName}>
            <Icon name={typeInfo.icon} />
          </span>
        )}
        <span className="eis-card-title">{task.title}</span>
        {task.displayKey && density !== 'compact' && <span className="eis-key">{task.displayKey}</span>}
      </div>

      {density !== 'compact' || rel || urgency !== 'none' ? (
        <div className="eis-card-meta">
          {props.showQuadrant && <span className={`eis-chip eis-q-${classify(task, ctx)}`}>{KO.quadrant[classify(task, ctx)].subtitle}</span>}
          {urgency === 'overdue' && <span className="eis-chip eis-tone-overdue">{KO.card.urgencyOverdue}</span>}
          {urgency === 'today' && <span className="eis-chip eis-tone-today">{KO.card.urgencyToday}</span>}
          {urgency === 'soon' && <span className="eis-chip eis-tone-soon">{KO.card.urgencySoon}</span>}
          {task.due && rel && (
            <span className={`eis-chip eis-due eis-tone-${rel.tone}`} title={withWeekdayKo(task.due)}>
              <Icon name="event" /> {density === 'compact' ? rel.text : `${withWeekdayKo(task.due)} · ${rel.text}`}
            </span>
          )}
          {density !== 'compact' && task.priority && (
            <span className={`eis-chip eis-priority eis-priority-${Math.max(0, priorityIdx)}`}>
              {priorityLabel(task.priority, ctx.priorities)}
            </span>
          )}
          {density !== 'compact' && status && <span className="eis-chip eis-status">{status.label}</span>}
          {availability.reason === 'blocked-status' && <span className="eis-chip eis-tone-blocked">{KO.card.blockedStatus}</span>}
          {availability.reason === 'blocked-dependency' && <span className="eis-chip eis-tone-blocked">{KO.card.blockedDependency}</span>}
          {availability.reason === 'future-start' && <span className="eis-chip eis-tone-later">{KO.card.futureStart(task.start)}</span>}
          {neglect?.neglected && (
            <span className="eis-chip eis-tone-neglected" title={neglect.missingDue ? KO.card.missingDue : undefined}>
              {KO.card.neglected(neglect.ageDays)}
              {neglect.missingDue ? ` · ${KO.card.missingDue}` : ''}
            </span>
          )}
          {task.archived && <span className="eis-chip">{KO.card.archived}</span>}
        </div>
      ) : null}

      {density === 'detailed' && (task.assignees.length > 0 || task.tags.length > 0 || task.start) && (
        <div className="eis-card-detail">
          {task.start && availability.reason !== 'future-start' && <span>{KO.card.start(task.start)}</span>}
          {task.assignees.map((a) => (
            <span key={a} className="eis-owner">
              <Icon name="person" /> {a}
            </span>
          ))}
          {task.tags.map((t) => (
            <span key={t} className="eis-tag">
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 분면 ────────────────────────────────────────────────────────────

export interface QuadrantProps {
  id: QuadrantId
  count: number
  hidden: number
  collapsed: boolean
  canCreate: boolean
  dropActive: boolean
  children: ReactNode
  onToggle(): void
  onCreate(): void
  onDragOver(): void
  onDragLeave(): void
  onDrop(taskId: string): void
  /** 제목만으로 바로 만든다. 성공하면 true. 없으면 빠른 추가 입력을 숨긴다. */
  onQuickAdd?(title: string): Promise<boolean>
}

/** 분면 하단의 한 줄 입력. Enter 로 만들고 입력란은 열린 채로 남아 연속 입력할 수 있다. */
function QuickAdd(props: { onSubmit(title: string): Promise<boolean> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const submit = async () => {
    const title = value.trim()
    if (!title || busy) return
    setBusy(true)
    try {
      if (await props.onSubmit(title)) setValue('')
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }
  return (
    <div className="eis-quickadd">
      <Icon name="add" />
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        placeholder={KO.create.quickPlaceholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit()
          if (e.key === 'Escape') {
            setValue('')
            inputRef.current?.blur()
          }
        }}
      />
    </div>
  )
}

export function Quadrant(props: QuadrantProps) {
  const q = KO.quadrant[props.id]
  return (
    <section
      className={`eis-quadrant eis-q-${props.id} ${props.dropActive ? 'is-drop' : ''} ${props.collapsed ? 'is-collapsed' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        props.onDragOver()
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) props.onDragLeave()
      }}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('text/plain')
        if (id) props.onDrop(id)
      }}
    >
      <header className="eis-quadrant-head">
        <button className="eis-icon-btn" onClick={props.onToggle} aria-expanded={!props.collapsed} title={props.collapsed ? '펼치기' : '접기'}>
          <Icon name={props.collapsed ? 'chevron_right' : 'expand_more'} />
        </button>
        <div className="eis-quadrant-titles">
          <span className="eis-quadrant-subtitle">{q.subtitle}</span>
          <span className="eis-quadrant-title">{q.title}</span>
        </div>
        <span className="eis-count">{props.count}</span>
        {props.canCreate && (
          <button className="eis-icon-btn" onClick={props.onCreate} title={KO.create.detailed}>
            <Icon name="edit_note" />
          </button>
        )}
      </header>
      {!props.collapsed && (
        <div className="eis-quadrant-body">
          {props.count === 0 ? <div className="eis-empty">{KO.empty[props.id]}</div> : props.children}
          {props.hidden > 0 && <div className="eis-more">{KO.card.more(props.hidden)}</div>}
        </div>
      )}
      {!props.collapsed && props.onQuickAdd && <QuickAdd onSubmit={props.onQuickAdd} />}
    </section>
  )
}

// ── 우클릭 메뉴 ─────────────────────────────────────────────────────

export interface MenuState {
  task: MatrixTask
  x: number
  y: number
}

export interface ContextMenuProps {
  menu: MenuState
  ctx: ClassifyContext
  canWrite: boolean
  canDelete: boolean
  canUndo: boolean
  onMove(task: MatrixTask, q: QuadrantId): void
  onQuickDue(task: MatrixTask, kind: QuickDueKind): void
  onOpen(task: MatrixTask): void
  onOpenDocument(task: MatrixTask): void
  onDelete(task: MatrixTask): void
  onUndo(): void
  onClose(): void
}

export function ContextMenu(props: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: props.menu.x, top: props.menu.y })
  const { task } = props.menu
  const current = classify(task, props.ctx)
  const movable = props.canWrite && !isTerminal(task.status, props.ctx.statuses)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(4, Math.min(props.menu.x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(props.menu.y, window.innerHeight - r.height - 4))
    })
  }, [props.menu.x, props.menu.y])

  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      props.onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('mousedown', close, true)
    window.addEventListener('blur', props.onClose)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('blur', props.onClose)
      window.removeEventListener('keydown', onKey)
    }
  }, [props.onClose])

  const item = (key: string, label: string, onClick: () => void, opts: { icon?: string; disabled?: boolean; danger?: boolean } = {}) => (
    <button
      key={key}
      className={`eis-menu-item ${opts.danger ? 'is-danger' : ''}`}
      disabled={opts.disabled}
      onClick={() => {
        props.onClose()
        onClick()
      }}
    >
      <Icon name={opts.icon ?? 'chevron_right'} />
      {label}
    </button>
  )

  return (
    <div ref={ref} className="eis-menu" style={pos} role="menu">
      <div className="eis-menu-label">{KO.menu.moveTo}</div>
      {QUADRANT_ORDER.map((q) =>
        item(`q-${q}`, `${KO.quadrant[q].subtitle} · ${KO.quadrant[q].title}`, () => props.onMove(task, q), {
          icon: q === current ? 'radio_button_checked' : 'radio_button_unchecked',
          disabled: !movable || q === current || unreachableReason(task, q, props.ctx) !== null
        })
      )}
      <div className="eis-menu-sep" />
      {task.fields.due && QUICK_DUE_KINDS.map((k) =>
        item(`d-${k}`, KO.menu.dueQuick[k], () => props.onQuickDue(task, k), {
          icon: k === 'clear' ? 'event_busy' : 'event',
          disabled: !movable || (k === 'clear' && !task.due)
        })
      )}
      <div className="eis-menu-sep" />
      {item('open', KO.menu.open, () => props.onOpen(task), { icon: 'open_in_new' })}
      {task.documentPath && item('doc', KO.menu.openDocument, () => props.onOpenDocument(task), { icon: 'description' })}
      {props.canUndo && item('undo', KO.menu.undo, props.onUndo, { icon: 'undo' })}
      {props.canDelete &&
        !task.fileBacked &&
        item('del', KO.menu.deleteTask, () => props.onDelete(task), { icon: 'delete', danger: true })}
    </div>
  )
}

// ── 대화상자 ────────────────────────────────────────────────────────

export function Modal(props: { title: string; children: ReactNode; onClose(): void; footer: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])
  return (
    <div className="eis-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="eis-modal" role="dialog" aria-modal="true" aria-label={props.title}>
        <h3 className="eis-modal-title">{props.title}</h3>
        <div className="eis-modal-body">{props.children}</div>
        <div className="eis-modal-footer">{props.footer}</div>
      </div>
    </div>
  )
}

export function ConfirmMoveDialog(props: {
  plan: QuadrantWritePlan
  kind: 'move' | 'due'
  priorities: readonly PriorityConfig[]
  onCancel(): void
  onApply(dontAskAgain: boolean): void
}) {
  const [dontAsk, setDontAsk] = useState(false)
  const fmt = (field: string, v: string) =>
    !v ? KO.confirm.emptyValue : field === 'priority' ? priorityLabel(v, props.priorities) : withWeekdayKo(v)
  return (
    <Modal
      title={props.kind === 'move' ? KO.confirm.title : KO.confirm.dueTitle}
      onClose={props.onCancel}
      footer={
        <>
          {props.kind === 'move' && (
            <label className="eis-check">
              <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
              {KO.confirm.dontAskAgain}
            </label>
          )}
          <span className="eis-spacer" />
          <button className="eis-btn" onClick={props.onCancel}>
            {KO.confirm.cancel}
          </button>
          <button className="eis-btn is-primary" autoFocus onClick={() => props.onApply(dontAsk)}>
            {KO.confirm.apply}
          </button>
        </>
      }
    >
      <p>
        {props.kind === 'move'
          ? KO.confirm.body(props.plan.title, KO.quadrant[props.plan.to].subtitle)
          : KO.confirm.dueBody(props.plan.title)}
      </p>
      <table className="eis-diff">
        <thead>
          <tr>
            <th>{KO.confirm.colField}</th>
            <th>{KO.confirm.colBefore}</th>
            <th>{KO.confirm.colAfter}</th>
          </tr>
        </thead>
        <tbody>
          {props.plan.changes.map((c) => (
            <tr key={c.field} title={c.reason}>
              <td>{KO.confirm.field[c.field]}</td>
              <td className="eis-diff-before">{fmt(c.field, c.before)}</td>
              <td className="eis-diff-after">{fmt(c.field, c.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.kind === 'move' && props.plan.from !== props.plan.to && (
        <p className="eis-muted">
          {KO.quadrant[props.plan.from].subtitle} → {KO.quadrant[props.plan.to].subtitle}
        </p>
      )}
    </Modal>
  )
}

export function ConfirmDeleteDialog(props: { task: MatrixTask; onCancel(): void; onConfirm(): void }) {
  return (
    <Modal
      title={KO.deleteConfirm.title}
      onClose={props.onCancel}
      footer={
        <>
          <span className="eis-spacer" />
          <button className="eis-btn" autoFocus onClick={props.onCancel}>
            {KO.confirm.cancel}
          </button>
          <button className="eis-btn is-danger" onClick={props.onConfirm}>
            {KO.deleteConfirm.confirm}
          </button>
        </>
      }
    >
      <p>{KO.deleteConfirm.body(props.task.title)}</p>
    </Modal>
  )
}

export function CreateTaskDialog(props: {
  quadrant: QuadrantId
  types: TrackerTypeInfo[]
  priorities: readonly PriorityConfig[]
  defaultPriority: string
  defaultDue: string
  onCancel(): void
  onCreate(input: { type: TrackerTypeInfo; title: string; priority: string; due: string }): Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [typeId, setTypeId] = useState(props.types.find((t) => t.type === 'task')?.type ?? props.types[0]?.type ?? '')
  const [priority, setPriority] = useState(props.defaultPriority)
  const [due, setDue] = useState(props.defaultDue)
  const [busy, setBusy] = useState(false)
  const type = props.types.find((t) => t.type === typeId)
  const palette = type && type.priorities.length > 0 ? type.priorities : props.priorities
  const submit = async () => {
    if (!type || !title.trim() || busy) return
    setBusy(true)
    try {
      await props.onCreate({ type, title, priority, due })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={KO.create.title(KO.quadrant[props.quadrant].subtitle)}
      onClose={props.onCancel}
      footer={
        <>
          <span className="eis-spacer" />
          <button className="eis-btn" onClick={props.onCancel}>
            {KO.create.cancel}
          </button>
          <button className="eis-btn is-primary" disabled={!type || !title.trim() || busy} onClick={submit}>
            {KO.create.submit}
          </button>
        </>
      }
    >
      <div className="eis-form">
        <label>
          <span>{KO.create.name}</span>
          <input
            autoFocus
            value={title}
            placeholder={KO.create.placeholder}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
          />
        </label>
        <label>
          <span>{KO.create.type}</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {props.types.map((t) => (
              <option key={t.type} value={t.type}>
                {t.displayName}
              </option>
            ))}
          </select>
        </label>
        {type?.fields.priority && (
          <label>
            <span>{KO.create.priority}</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {palette.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {type?.fields.due && (
          <label>
            <span>{KO.create.due}</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        )}
      </div>
    </Modal>
  )
}
