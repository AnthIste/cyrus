# Internal Changelog

This changelog documents internal development changes, refactors, tooling updates, and other non-user-facing modifications.

## [Unreleased]

### Added
- **Azure DevOps VCS platform support** - Extended `RepositoryConfig` with `vcsType`, `repoUrl`, and `azureDevOps` fields. Added platform-aware procedure selection in `ProcedureAnalyzer` and Azure DevOps-specific procedures (`full-development-azure`, `documentation-edit-azure`, `debugger-full-azure`). Created new subroutines `az-pr-create.md` and `az-pr-finalize.md` for Azure DevOps PR operations. Updated EdgeWorker routing context to include `<vcs_type>` and `<repo_url>` tags. ([RUB-62](https://linear.app/rbakker/issue/RUB-62), [#1](https://github.com/AnthIste/cyrus/pull/1))

## [0.2.13] - 2026-01-15

(No internal changes in this release)

## [0.2.12] - 2026-01-09

(No internal changes in this release)

## [0.2.11] - 2026-01-07

(No internal changes in this release)

## [0.2.10] - 2026-01-06

(No internal changes in this release)

## [0.2.9] - 2025-12-30

(No internal changes in this release)

## [0.2.8] - 2025-12-28

(No internal changes in this release)

## [0.2.7] - 2025-12-28

### Changed
- Moved publishing docs from CLAUDE.md to `/release` skill for cleaner documentation and easier invocation ([CYPACK-667](https://linear.app/ceedar/issue/CYPACK-667), [#705](https://github.com/ceedaragents/cyrus/pull/705))

## [0.2.6] - 2025-12-22

### Fixed
- Fixed the CLI issue tracker's `labels()` method to return actual label data instead of an empty array, enabling correct runner selection (Codex/Gemini) in F1 tests ([CYPACK-547](https://linear.app/ceedar/issue/CYPACK-547), [#624](https://github.com/ceedaragents/cyrus/pull/624))
