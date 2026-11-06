import type { QuickDueKind } from '../model/planMove'
import type { QuadrantId } from '../model/types'

/** 사용자에게 보이는 문자열. */
export const KO = {
  viewTitle: '아이젠하워 매트릭스',

  quadrant: {
    do: { title: '긴급 · 중요', subtitle: '즉시 실행' },
    plan: { title: '중요', subtitle: '일정 계획' },
    delegate: { title: '긴급', subtitle: '위임' },
    drop: { title: '긴급하지도 중요하지도 않음', subtitle: '제외 검토' }
  } satisfies Record<QuadrantId, { title: string; subtitle: string }>,

  axis: { urgent: '긴급', notUrgent: '긴급하지 않음', important: '중요', notImportant: '중요하지 않음' },

  empty: {
    do: '급한 불이 없습니다.',
    plan: '계획된 작업이 없습니다.',
    delegate: '해당 작업이 없습니다.',
    drop: '해당 작업이 없습니다.',
    all: '트래커 항목이 없습니다. 트래커에서 작업을 만들거나 각 분면의 + 버튼을 눌러 보세요.',
    allFiltered: '필터 조건에 맞는 작업이 없습니다.',
    resetFilter: '필터 초기화'
  } satisfies Record<QuadrantId | 'all' | 'allFiltered' | 'resetFilter', string>,

  toolbar: {
    searchPlaceholder: '제목·키·태그·담당자 검색…',
    type: '타입',
    typeAll: '전체 타입',
    sort: '정렬',
    density: '카드',
    showCompleted: '완료 표시',
    showArchived: '보관 표시',
    showAgent: '에이전트 작업',
    reset: '초기화',
    refresh: '새로고침',
    undo: '되돌리기',
    settings: '설정',
    filterActive: '필터 적용 중'
  },

  sort: { due: '마감일', priority: '우선순위', title: '제목', updated: '수정일' },
  density: { compact: '간결', default: '기본', detailed: '상세' },

  card: {
    open: (title: string) => `${title} 열기`,
    more: (n: number) => `외 ${n}개 더 있음`,
    archived: '보관됨',
    blockedStatus: '차단됨',
    blockedDependency: '선행 작업 대기',
    futureStart: (date: string) => `${date} 시작`,
    urgencyOverdue: '기한 초과',
    urgencyToday: '오늘 마감',
    urgencySoon: '마감 임박',
    neglected: (days: number) => `${days}일 방치`,
    missingDue: '마감일 없음',
    start: (date: string) => `시작 ${date}`,
    locked: '완료된 작업은 분류를 보존하기 위해 이동할 수 없습니다.'
  },

  unavailable: {
    title: '지금 실행할 수 없음',
    subtitle: '차단 상태 · 선행 작업 대기 · 시작일 전',
    empty: '실행을 막는 작업이 없습니다.'
  },

  briefing: {
    title: (n: number) => `달라진 작업 ${n}개`,
    subtitle: '이전 확인 이후 분면·긴급도·실행 상태가 바뀌었습니다.',
    dismiss: '모두 확인',
    more: (n: number) => `외 ${n}개 변화`,
    neglected: '방치 위험으로 전환',
    kind: { quadrant: '분면', availability: '실행 상태', urgency: '긴급도', priority: '우선순위' } as Record<string, string>,
    value: {
      available: '실행 가능',
      'blocked-status': '차단됨',
      'blocked-dependency': '선행 작업 대기',
      'future-start': '시작일 전',
      none: '여유',
      soon: '마감 임박',
      today: '오늘 마감',
      overdue: '기한 초과'
    } as Record<string, string>
  },

  menu: {
    moveTo: '사분면 이동',
    open: '트래커에서 열기',
    openDocument: '원본 문서 열기',
    deleteTask: '작업 삭제',
    undo: '되돌리기',
    dueQuick: {
      today: '마감일: 오늘',
      tomorrow: '마감일: 내일',
      plusDay: '마감일: +1일',
      plusWeek: '마감일: +1주',
      nextMonday: '마감일: 다음 월요일',
      clear: '마감일 지우기'
    } satisfies Record<QuickDueKind, string>
  },

  banner: {
    readOnly: '이 Nimbalyst 버전에서 트래커 쓰기 경로를 찾지 못해 읽기 전용으로 표시합니다.'
  },

  confirm: {
    title: '사분면 이동',
    dueTitle: '마감일 변경',
    body: (taskTitle: string, quadrant: string) => `"${taskTitle}" 작업을 「${quadrant}」로 이동합니다.`,
    dueBody: (taskTitle: string) => `"${taskTitle}" 작업의 마감일을 바꿉니다.`,
    colField: '항목',
    colBefore: '현재',
    colAfter: '변경 후',
    field: { due: '마감일', priority: '우선순위', start: '시작일' } as Record<string, string>,
    emptyValue: '(없음)',
    dontAskAgain: '다음부터 확인하지 않기',
    cancel: '취소',
    apply: '적용'
  },

  deleteConfirm: {
    title: '작업 삭제',
    body: (taskTitle: string) => `"${taskTitle}" 작업을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
    confirm: '삭제'
  },

  create: {
    title: (quadrant: string) => `「${quadrant}」에 작업 추가`,
    name: '제목',
    type: '타입',
    priority: '우선순위',
    due: '마감일',
    submit: '만들기',
    cancel: '취소',
    placeholder: '무엇을 해야 하나요?',
    quickPlaceholder: '작업 추가 (Enter)',
    detailed: '타입·우선순위·마감일을 정해서 추가'
  },

  notice: {
    moved: (quadrant: string) => `「${quadrant}」로 이동했습니다.`,
    noChange: '바꿀 항목이 없습니다.',
    dueUpdated: '마감일을 변경했습니다.',
    undone: '되돌렸습니다.',
    created: '작업을 만들었습니다.',
    noDueField: (type: string) => `${type} 타입에는 마감일 필드가 없어 긴급도를 바꿀 수 없습니다.`,
    noPriorityField: (type: string) => `${type} 타입에는 우선순위 필드가 없어 중요도를 바꿀 수 없습니다.`,
    quickCreated: (title: string, quadrant: string) => `"${title}" 작업을 「${quadrant}」에 추가했습니다.`,
    deleted: '작업을 삭제했습니다.',
    transitions: (n: number) => `달라진 작업이 ${n}개 있습니다.`,
    error: (msg: string) => `오류: ${msg}`
  },

  settings: {
    title: '매트릭스 설정',
    back: '매트릭스로 돌아가기',
    classify: '분류 기준',
    urgencyWindowDays: '긴급 기준 (마감일까지 남은 일수 미만)',
    importantThresholdId: '중요 기준 (이 우선순위 이상)',
    separateUnavailableTasks: '실행할 수 없는 작업을 별도 영역으로 분리',
    showUrgencyLevels: '기한 초과 · 오늘 마감 · 마감 임박 표시',
    detectNeglectedTasks: '오래 수정되지 않은 중요 작업 표시',
    neglectedAfterDays: '방치 기준 (일)',
    display: '표시',
    maxCardsPerQuadrant: '분면당 최대 카드 수',
    move: '이동 동작',
    confirmOnDrop: '이동 전 변경 내용 확인',
    urgentDueStrategy: '긴급 분면으로 옮길 때 마감일',
    urgentDue: { today: '오늘', tomorrow: '내일', windowEdge: '긴급 기준의 마지막 날' } as Record<string, string>,
    notUrgentStrategy: '긴급하지 않은 분면으로 옮길 때 마감일',
    notUrgent: { push: '긴급 기준 밖으로 미루기', clear: '마감일 지우기' } as Record<string, string>,
    notUrgentPaddingDays: '미루는 여유 일수 (긴급 기준 + N일)',
    keepStartBeforeDue: '시작일이 새 마감일보다 늦으면 함께 당기기',
    types: '추적할 트래커 타입',
    typesHint: '마감일과 우선순위 중 하나라도 있는 타입만 놓을 수 있습니다. 없는 축은 고정됩니다.',
    typeAxes: { both: '긴급·중요 모두', dueOnly: '우선순위 없음 → 항상 "중요하지 않음"', priorityOnly: '마감일 없음 → 항상 "긴급하지 않음"' },
    briefing: '변화 알림',
    showTransitionBriefing: '이전 확인 이후 달라진 작업 알림',
    integration: '연동 상태',
    capability: {
      ipcList: '트래커 목록 (렌더러 IPC)',
      update: '항목 수정',
      create: '항목 생성',
      remove: '항목 삭제',
      live: '실시간 갱신'
    } as Record<string, string>,
    yes: '사용 가능',
    no: '사용 불가'
  }
}
