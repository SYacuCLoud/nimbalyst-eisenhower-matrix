# Eisenhower Matrix (Nimbalyst 확장)

[eisenhower-matrix-for-project-manager](https://github.com/SYacuCLoud/eisenhower-matrix-for-project-manager)(Obsidian dotpm용)를 Nimbalyst로 옮긴 확장입니다. dotpm 작업 노트 대신 **Nimbalyst 트래커 항목**(task, bug 등)을 긴급도와 중요도에 따라 2×2 매트릭스로 정리하고, 카드를 다른 분면으로 옮기면 마감일과 우선순위를 갱신합니다.

## 주요 기능

- `즉시 실행` · `일정 계획` · `위임` · `제외 검토` 4분면 (왼쪽 거터의 격자 아이콘으로 열기)
- 드래그 앤 드롭이나 우클릭 메뉴로 분면 이동 → 변경 필드 미리보기 → 적용
- 쓰기 직전 최신 값을 다시 읽어 동시 수정 충돌 검사, 마지막 변경 되돌리기
- 마감일 빠른 조정(오늘 · 내일 · +1일 · +1주 · 다음 월요일 · 지우기)
- 제목·키·태그·담당자 검색, 타입 필터, 완료·보관 표시, 정렬, 카드 밀도(간결·기본·상세)
- `Blocked` 상태, 미완료 선행 작업(`dependsOn`), 미래 시작일 작업을 "지금 실행할 수 없음" 영역으로 분리
- 긴급 작업의 `기한 초과` · `오늘 마감` · `마감 임박` 표시, 오래 수정되지 않은 중요 작업 표시
- 이전 확인 이후 분면·긴급도·실행 상태가 바뀐 작업 알림
- 분면 하단 입력란에 제목을 쓰고 Enter → 그 분면에 맞는 우선순위·마감일로 task 바로 생성(연속 입력 가능)
- 분면 머리의 편집 버튼으로 타입·우선순위·마감일을 정해서 만들기
- 트래커 화면, AI 에이전트, 팀 동기화로 추가·수정된 항목이 매트릭스에 실시간 반영
- 카드 클릭 시 Nimbalyst 트래커 항목 열기, 거터 배지에 즉시 실행 작업 수 표시

## 분류 규칙

- **긴급**: 마감일(`dueDate`)까지 남은 일수가 설정값(기본 3일) 미만. 완료 작업은 마지막 수정일 기준
- **중요**: 우선순위(`priority`)가 임계값(기본 `high`) 이상
- 마감일이나 우선순위 중 하나라도 가진 트래커 타입을 모두 표시합니다. 필드 이름은 타입 스키마의 역할(role)에서 찾습니다(예: milestone의 마감일은 `targetDate`).
- 한쪽 축이 없는 타입은 그 축이 고정됩니다. 마감일이 없는 bug·plan·decision은 항상 "긴급하지 않음", 우선순위가 없는 milestone은 항상 "중요하지 않음"이며, 그 방향으로는 옮길 수 없습니다.
- 추적할 타입은 매트릭스 설정의 **추적할 트래커 타입**에서 고릅니다. 새로 만든 타입은 자동으로 포함됩니다.

분면 이동 시 바뀌는 필드는 `priority`, `dueDate`, 그리고 새 마감일보다 늦은 경우의 `startDate`뿐입니다. 상태, 담당자, 태그, 관계, 본문은 바꾸지 않습니다. 파일 기반(frontmatter/inline) 항목은 원본 파일에, native 항목은 트래커 저장소에 씁니다.

## 연동 방식과 제한 사항

Nimbalyst 확장 SDK는 트래커 **읽기**(`host.data.query`)만 공개합니다. 수정·생성·삭제·항목 열기에는 Nimbalyst 트래커 UI가 쓰는 렌더러 IPC(`window.electronAPI`의 `document-service:*` 채널, `nimbalyst:navigate-tracker-item` 이벤트)를 사용합니다. 원본 플러그인이 dotpm 내부 경로를 쓰는 것과 같은 방식이라 Nimbalyst 업데이트로 바뀔 수 있습니다. 호출 전에 존재 여부를 확인하고, 없으면 DB 읽기로 바꿔 읽기 전용으로 표시합니다. 현재 상태는 매트릭스 설정의 **연동 상태**에서 확인할 수 있습니다.

## 빌드와 설치

```bash
npm install
npm test
npm run check:types
npm run build
```

`manifest.json`과 `dist/`를 `%APPDATA%\@nimbalyst\electron\extensions\com.syacucloud.eisenhower-matrix\`에 복사한 뒤 Nimbalyst를 다시 시작합니다. (Extension Dev Tools의 `extension_reload`를 쓸 수 있다면 그것으로도 됩니다.)
