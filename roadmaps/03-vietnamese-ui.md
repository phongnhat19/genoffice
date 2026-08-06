# Professional Vietnamese UI Roadmap

## Outcome

Ship a complete Vietnamese (`vi-VN`) interface across the GenOffice shell and
all editors, with natural professional terminology, correct date/number
locales, Vietnamese AI fallback replies, and visual quality checks for
diacritics and layout.

This feature covers the product UI. It does not promise Vietnamese spellcheck,
grammar checking, or document-proofing behavior from the operating system or a
selected AI provider.

## Current implementation

GenOffice has a shared, typed localization core in
[`packages/i18n/src/index.ts`](../packages/i18n/src/index.ts):

- `Lang` defines every supported UI language.
- `LANGS`, `normalizeLang`, and `htmlLang` drive validation, OS locale
  detection, and the document HTML language tag.
- `defineStrings` ensures every dictionary has exactly the same key set.
- `createI18n` provides interpolation at runtime.

The shell persists the selected language in `userData/app-settings.json` and
broadcasts changes to editors. See
[`apps/shell/src/main/index.ts`](../apps/shell/src/main/index.ts) and
[`apps/shell/src/renderer/src/locale.tsx`](../apps/shell/src/renderer/src/locale.tsx).

Each editor owns dictionary shards and a locale provider:

| App | Dictionary directory |
| --- | --- |
| Docs | [`apps/docs/src/renderer/i18n`](../apps/docs/src/renderer/i18n) |
| Sheets | [`apps/sheets/src/renderer/i18n`](../apps/sheets/src/renderer/i18n) |
| Slides | [`apps/slides/src/renderer/i18n`](../apps/slides/src/renderer/i18n) |
| PDF | [`apps/pdf/src/renderer/i18n`](../apps/pdf/src/renderer/i18n) |
| Shell | [`apps/shell/src/renderer/src`](../apps/shell/src/renderer/src) |

The editors also append a language-specific instruction to AI system prompts.
Vietnamese must be added to each `AI_LANG_DIRECTIVES` map, not just to visible
UI strings.

## Language contract

Use one language code and locale consistently:

```ts
type Lang = /* existing languages */ | 'vi'

// Platform and HTML locale
'vi' -> 'vi-VN'
```

`normalizeLang('vi')` and `normalizeLang('vi-VN')` must resolve to `vi`.
When macOS or Windows reports a Vietnamese system locale, GenOffice should open
in Vietnamese unless a user has already saved a different app preference.

For date, time, and number formatting, use `vi-VN`. Do not translate or alter
formula syntax merely because the UI is Vietnamese; spreadsheet formula locale
behavior must remain a separate, intentional product decision.

## Translation principles

### Voice

Use modern professional Vietnamese appropriate for desktop productivity software:

- Clear, direct, and respectful. Prefer concise imperatives for commands.
- Keep common established Office vocabulary stable across all apps.
- Preserve keyboard shortcuts, file extensions, product names, model names, and
  technical identifiers unless there is an established Vietnamese equivalent.
- Keep placeholders such as `{name}`, `{count}`, and `{reason}` exactly intact.
- Do not translate code, JSON keys, file paths, command names, or MIME types.

### Terminology baseline

Create and maintain a reviewed glossary before translating all strings.

| English | Preferred Vietnamese | Notes |
| --- | --- | --- |
| File | Tệp | Use consistently in menus and messages |
| Save | Lưu | “Lưu thành…” for Save As |
| Document | Tài liệu | Docs product and general documents |
| Workbook | Sổ làm việc | Use in Sheets context |
| Worksheet | Trang tính | Use in Sheets context |
| Slide | Trang chiếu | Use in Slides context |
| Presentation | Bản trình bày | Product/context dependent |
| Ribbon | Dải lệnh | Use only where the UI names the control |
| Settings | Cài đặt | Avoid mixed “Thiết lập” unless a specific product area requires it |
| Undo / Redo | Hoàn tác / Làm lại | Keep keyboard shortcut labels unchanged |
| AI assistant | Trợ lý AI | Keep “AI” as the familiar abbreviation |
| Sync | Đồng bộ | “Đồng bộ ngay” for an explicit action |

Have a professional Vietnamese translator or reviewer own this glossary. Machine
translation can prepare a draft but cannot be the final authority for product
terminology, tone, ambiguity, or truncation-sensitive labels.

## Delivery plan

### Phase 0: inventory and glossary

- Freeze the English source keys for the release window where possible.
- Export all dictionary keys and count strings per product area.
- Create a translation memory and glossary with owner/reviewer approval.
- Identify strings that are source text versus model prompts, error text,
  accessibility labels, or menu labels.

Acceptance criteria:

- Every English source string has an owner and context for translators.
- The glossary resolves ambiguous Office terms before bulk translation begins.

### Phase 1: shared language plumbing

- Add `vi` to `Lang`, `LANGS`, `HTML_LANGS`, and locale validation.
- Add `vi-VN` to each app's date/number locale map.
- Add Vietnamese to the shell's language picker and main-process menu strings.
- Add Vietnamese AI fallback directives in Docs, Sheets, Slides, and PDF.
- Update type-level i18n test fixtures.

Acceptance criteria:

- `GENOFFICE_LANG=vi-VN` selects Vietnamese.
- Selecting Vietnamese in Shell persists across a restart and propagates to an
  open editor.
- The HTML root language is `vi-VN` in every renderer.

### Phase 2: translation coverage

- Translate Shell first, including onboarding, account, settings, updater, and
  menu labels.
- Translate Docs, then Slides, Sheets, and PDF dictionary shards.
- Translate accessibility labels, tooltips, dialogs, empty states, errors, and
  AI preset prompts alongside visible labels.
- Preserve every interpolation placeholder and avoid empty translations.

Acceptance criteria:

- Every `vi` dictionary has exactly the source key set.
- All placeholders match the source language.
- No English fallback appears in normal Vietnamese product flows except for
  intentional product names, technical terms, and unsupported upstream errors.

### Phase 3: professional review and visual QA

- Perform a linguistic review in context, not only in spreadsheets or source
  files.
- Check ribbon tabs, toolbar labels, dialogs, menus, status bars, onboarding,
  update windows, and AI panels at macOS and Windows display scales.
- Test Vietnamese characters with all bundled and system-fallback fonts.
- Check narrow controls for wrapping, truncation, overlap, and accelerator key
  collisions.
- Verify right-to-left behavior remains unchanged for existing Arabic/Hebrew
  translations.

Acceptance criteria:

- A native Vietnamese reviewer approves high-traffic and high-risk workflows.
- Screenshots demonstrate correct accents and no critical clipping at supported
  display scales.
- Existing languages retain exact key parity and pass their tests.

## File-level implementation map

| Concern | Existing location |
| --- | --- |
| Language type and normalizer | `packages/i18n/src/index.ts` |
| Core i18n tests | `packages/i18n/tests/i18n.test.ts` |
| Shell language persistence and menus | `apps/shell/src/main/index.ts` |
| Shell date/number locale | `apps/shell/src/renderer/src/locale.tsx` |
| Docs locale and AI directive | `apps/docs/src/renderer/i18n/locale.tsx` |
| Sheets locale and AI directive | `apps/sheets/src/renderer/i18n/locale.tsx` |
| Slides locale and AI directive | `apps/slides/src/renderer/i18n/locale.tsx` |
| PDF locale and AI directive | `apps/pdf/src/renderer/i18n/locale.tsx` |
| Per-app visible strings | Each app's `renderer/i18n/strings*.ts` files |

The existing type contract means adding `vi` will intentionally produce compile
errors until every dictionary is complete. Treat those errors as the translation
coverage checklist rather than weakening the type system.

## Test plan

Extend the existing tests rather than adding a separate, weaker translation
path:

- [`packages/i18n/tests/i18n.test.ts`](../packages/i18n/tests/i18n.test.ts):
  add `vi`, `vi-VN`, `isLang('vi')`, and `htmlLang('vi')` cases.
- Per-app i18n tests: verify Vietnamese dictionary presence, exact key parity,
  non-empty translations, and placeholder parity. PDF already provides this
  pattern in [`apps/pdf/tests/i18n-strings.test.ts`](../apps/pdf/tests/i18n-strings.test.ts).
- Shell and editor integration tests: switch language, reload, and confirm IPC
  receives `vi`.
- Snapshot or browser-level tests: use Vietnamese strings with dense accents in
  menus and narrow toolbars.

Manual acceptance routes:

1. Launch with a Vietnamese OS locale and with `GENOFFICE_LANG=vi-VN`.
2. Switch language from the shell while Docs, Sheets, Slides, and PDF are open.
3. Create, save, rename, print, and reopen files in every editor.
4. Exercise error dialogs, account UI, updates, and AI panels.
5. Ask the AI a message with no obvious language and confirm its fallback reply
   is Vietnamese; then ask in English and confirm it follows the user message.

## Quality gates

### Linguistic gate

- Native reviewer signs off on the glossary and the top user journeys.
- No literal machine-translation artifacts, inconsistent pronouns, or mixed
  Vietnamese/English labels without an intentional reason.
- Terms such as Tệp, Tài liệu, Trang tính, Trang chiếu, and Hoàn tác are used
  consistently.

### Technical gate

- `npm test -w @genoffice/i18n` passes.
- Every app's i18n parity test passes.
- `npm run typecheck` passes with `vi` included in every `Record<Lang, ...>`.
- No placeholders, Unicode diacritics, or HTML language tags are corrupted.

### Visual gate

- Vietnamese text remains legible in default UI fonts on macOS and Windows.
- Common actions do not truncate at normal window widths.
- Accessibility names are Vietnamese and match the visible control intent.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Thousands of strings produce inconsistent vocabulary | Approved glossary, translation memory, and single reviewer |
| Placeholder or key damage during bulk translation | Typed `defineStrings` contract plus parity tests |
| Vietnamese labels exceed control width | Contextual visual QA on real windows and targeted copy shortening |
| AI replies fall back to another language | Add `vi` to every `AI_LANG_DIRECTIVES` record and test it |
| Locale changes affect spreadsheet behavior unexpectedly | Limit this feature to UI/date formatting unless formula localization is separately specified |
| Font fallback renders accents poorly | Verify bundled Latin fonts and both supported operating systems |

## Definition of done

Vietnamese is done when it is selectable and auto-detected as `vi-VN`, persists
across the suite, has complete reviewed translations in every app, guides AI
fallback replies correctly, and passes type, parity, linguistic, and visual QA.
