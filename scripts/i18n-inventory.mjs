#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const dictionaryFiles = [
  'apps/shell/src/renderer/src/strings.ts',
  'apps/docs/src/renderer/i18n/strings-app.ts',
  'apps/docs/src/renderer/i18n/strings-ribbon.ts',
  'apps/docs/src/renderer/i18n/strings-editor.ts',
  'apps/docs/src/renderer/i18n/strings-ai.ts',
  'apps/sheets/src/renderer/i18n/strings-app.ts',
  'apps/sheets/src/renderer/i18n/strings-dialogs.ts',
  'apps/sheets/src/renderer/i18n/strings-ai.ts',
  'apps/slides/src/renderer/i18n/strings-app.ts',
  'apps/slides/src/renderer/i18n/strings-ribbon.ts',
  'apps/slides/src/renderer/i18n/strings-panes.ts',
  'apps/slides/src/renderer/i18n/strings-ai.ts',
  'apps/pdf/src/renderer/i18n/strings.ts',
]

function keysFromEnglishDictionary(file) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((line) => /^  en: \{$/.test(line))
  if (start < 0) throw new Error(`No English dictionary found in ${file}`)

  const keys = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^  },$/.test(line)) return keys

    const match = /^    ([A-Za-z_$][\w$]*):/.exec(line)
    if (match) keys.push(match[1])
  }

  throw new Error(`English dictionary in ${file} is not closed`)
}

const root = process.cwd()
const dictionaries = dictionaryFiles.map((file) => {
  const absolutePath = resolve(root, file)
  return { file: relative(root, absolutePath), keys: keysFromEnglishDictionary(absolutePath) }
})

const totalStrings = dictionaries.reduce((total, dictionary) => total + dictionary.keys.length, 0)
process.stdout.write(`${JSON.stringify({ totalStrings, dictionaries }, null, 2)}\n`)
