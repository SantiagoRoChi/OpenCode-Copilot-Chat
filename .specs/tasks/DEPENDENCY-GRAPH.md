# Task Dependency Graph

## Visual Overview

```
Phase 1 (Parallel — No Dependencies):
┌─────────────────────────────────────────────────────────────┐
│  Task 1: modelRegistry    [Opus]   ← Foundation            │
│  Task 2: apiClient        [Opus]   ← HTTP client           │
│  Task 6: serverProvider   [Opus]   ← Fix local server      │
│  Task 7: types            [Haiku]  ← Add response types    │
└─────────────────────────────────────────────────────────────┘
         │           │           │           │
         ▼           ▼           │           │
Phase 2 (Parallel — Depend on Phase 1):
┌─────────────────────────────────────────────────────────────┐
│  Task 3: anthropicAdapter [Sonnet] ← Needs Task 1, 7       │
│  Task 4: responsesAdapter [Sonnet] ← Needs Task 1, 7       │
└─────────────────────────────────────────────────────────────┘
         │           │
         ▼           ▼
Phase 3 (Sequential — Depends on All):
┌─────────────────────────────────────────────────────────────┐
│  Task 5: baseProvider     [Opus]   ← Needs 1, 2, 3, 4     │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
Phase 4 (Final — Integration):
┌─────────────────────────────────────────────────────────────┐
│  Task 8: integrationTest  [Opus]   ← Needs all             │
└─────────────────────────────────────────────────────────────┘
```

## Parallel Execution Opportunities

| Phase | Tasks | Can Run In Parallel? | Model |
|-------|-------|---------------------|-------|
| 1 | Task 1, Task 2, Task 6, Task 7 | YES | Opus, Opus, Opus, Haiku |
| 2 | Task 3, Task 4 | YES | Sonnet, Sonnet |
| 3 | Task 5 | NO (sequential) | Opus |
| 4 | Task 8 | NO (final) | Opus |

## Total Agents Required

- Phase 1: 4 agents (parallel)
- Phase 2: 2 agents (parallel)
- Phase 3: 1 agent
- Phase 4: 1 agent
- **Total: 8 agents minimum** (4 in phase 1 can run simultaneously)

## Resume Instructions

If context is lost:

1. Check `.specs/tasks/draft/` for pending tasks
2. Check `.specs/reports/` for completed task reports
3. Read the task spec file for the next pending task
4. Each task spec contains: Input, Output, Validation, Acceptance Criteria
5. Run the validation commands to verify the task completed correctly
6. Continue with the next task in the dependency graph
