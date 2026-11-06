import type { ReactNode } from 'react'
import type { BridgeCapabilities, TrackerTypeInfo } from '../bridge/trackerBridge'
import type { PriorityConfig } from '../model/types'
import type { EisenSettings } from '../settings'
import { Icon } from './components'
import { KO } from './strings'

type Patch = (patch: Partial<EisenSettings>) => void

function Row(props: { label: string; children: ReactNode }) {
  return (
    <label className="eis-setting">
      <span className="eis-setting-label">{props.label}</span>
      <span className="eis-setting-control">{props.children}</span>
    </label>
  )
}

function Toggle(props: { value: boolean; onChange(v: boolean): void }) {
  return <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
}

function NumberInput(props: { value: number; min: number; max: number; onChange(v: number): void }) {
  return (
    <input
      type="number"
      min={props.min}
      max={props.max}
      value={props.value}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) props.onChange(Math.min(props.max, Math.max(props.min, Math.round(n))))
      }}
    />
  )
}

export function SettingsView(props: {
  settings: EisenSettings
  priorities: readonly PriorityConfig[]
  /** 매트릭스에 놓을 수 있는 타입 전체 */
  types: TrackerTypeInfo[]
  caps: BridgeCapabilities
  onPatch: Patch
  onBack(): void
}) {
  const { settings: s, onPatch } = props
  return (
    <div className="eis-settings">
      <div className="eis-settings-head">
        <button className="eis-btn" onClick={props.onBack}>
          <Icon name="arrow_back" /> {KO.settings.back}
        </button>
        <h2>{KO.settings.title}</h2>
      </div>

      <h3>{KO.settings.types}</h3>
      <p className="eis-muted">{KO.settings.typesHint}</p>
      {props.types.map((t) => {
        const tracked = !s.excludedTypes.includes(t.type)
        const axes =
          t.fields.due && t.fields.priority
            ? KO.settings.typeAxes.both
            : t.fields.due
              ? KO.settings.typeAxes.dueOnly
              : KO.settings.typeAxes.priorityOnly
        return (
          <label key={t.type} className="eis-setting">
            <span className="eis-setting-label">
              <Icon name={t.icon} /> {t.displayName} <span className="eis-muted">· {axes}</span>
            </span>
            <span className="eis-setting-control">
              <Toggle
                value={tracked}
                onChange={(v) =>
                  onPatch({
                    excludedTypes: v ? s.excludedTypes.filter((x) => x !== t.type) : [...s.excludedTypes, t.type]
                  })
                }
              />
            </span>
          </label>
        )
      })}

      <h3>{KO.settings.classify}</h3>
      <Row label={KO.settings.urgencyWindowDays}>
        <NumberInput value={s.urgencyWindowDays} min={1} max={14} onChange={(v) => onPatch({ urgencyWindowDays: v })} />
      </Row>
      <Row label={KO.settings.importantThresholdId}>
        <select value={s.importantThresholdId} onChange={(e) => onPatch({ importantThresholdId: e.target.value })}>
          {props.priorities.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={KO.settings.separateUnavailableTasks}>
        <Toggle value={s.separateUnavailableTasks} onChange={(v) => onPatch({ separateUnavailableTasks: v })} />
      </Row>
      <Row label={KO.settings.showUrgencyLevels}>
        <Toggle value={s.showUrgencyLevels} onChange={(v) => onPatch({ showUrgencyLevels: v })} />
      </Row>
      <Row label={KO.settings.detectNeglectedTasks}>
        <Toggle value={s.detectNeglectedTasks} onChange={(v) => onPatch({ detectNeglectedTasks: v })} />
      </Row>
      <Row label={KO.settings.neglectedAfterDays}>
        <NumberInput value={s.neglectedAfterDays} min={3} max={90} onChange={(v) => onPatch({ neglectedAfterDays: v })} />
      </Row>

      <h3>{KO.settings.display}</h3>
      <Row label={KO.settings.maxCardsPerQuadrant}>
        <NumberInput value={s.maxCardsPerQuadrant} min={20} max={1000} onChange={(v) => onPatch({ maxCardsPerQuadrant: v })} />
      </Row>

      <h3>{KO.settings.move}</h3>
      <Row label={KO.settings.confirmOnDrop}>
        <Toggle value={s.confirmOnDrop} onChange={(v) => onPatch({ confirmOnDrop: v })} />
      </Row>
      <Row label={KO.settings.urgentDueStrategy}>
        <select
          value={s.urgentDueStrategy}
          onChange={(e) => onPatch({ urgentDueStrategy: e.target.value as EisenSettings['urgentDueStrategy'] })}
        >
          {Object.entries(KO.settings.urgentDue).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={KO.settings.notUrgentStrategy}>
        <select
          value={s.notUrgentStrategy}
          onChange={(e) => onPatch({ notUrgentStrategy: e.target.value as EisenSettings['notUrgentStrategy'] })}
        >
          {Object.entries(KO.settings.notUrgent).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={KO.settings.notUrgentPaddingDays}>
        <NumberInput value={s.notUrgentPaddingDays} min={1} max={30} onChange={(v) => onPatch({ notUrgentPaddingDays: v })} />
      </Row>
      <Row label={KO.settings.keepStartBeforeDue}>
        <Toggle value={s.keepStartBeforeDue} onChange={(v) => onPatch({ keepStartBeforeDue: v })} />
      </Row>

      <h3>{KO.settings.briefing}</h3>
      <Row label={KO.settings.showTransitionBriefing}>
        <Toggle value={s.showTransitionBriefing} onChange={(v) => onPatch({ showTransitionBriefing: v })} />
      </Row>

      <h3>{KO.settings.integration}</h3>
      {(['ipcList', 'update', 'create', 'remove', 'live'] as const).map((key) => (
        <div key={key} className="eis-setting">
          <span className="eis-setting-label">{KO.settings.capability[key]}</span>
          <span className={`eis-chip ${props.caps[key] ? 'eis-tone-ok' : 'eis-tone-overdue'}`}>
            {props.caps[key] ? KO.settings.yes : KO.settings.no}
          </span>
        </div>
      ))}
    </div>
  )
}
