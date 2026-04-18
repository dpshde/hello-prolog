import { html, reactive, svg } from '@arrow-js/core'

import './style.css'

import { PRESETS, buildWorld, runQuery } from './prolog.js'

/* ── Constants ── */

const STORAGE_KEY = 'helloprolog:state'
const MAX_HISTORY = 50
const MAX_SUGGESTIONS = 8

const PROLOG_TEACHING_SNIPPETS = [
  {
    id: 'teach-unify',
    title: 'X = Value.',
    insert: 'X = Value.',
    kind: 'syntax',
    meta: 'unification',
    preview: '',
    detail: 'Bind X to a value, or test whether two terms unify.',
    selection: [0, 1],
    keywords: ['equals', 'assign', 'bind', 'unify'],
    weight: 20,
  },
  {
    id: 'teach-and',
    title: 'Goal1, Goal2.',
    insert: 'Goal1, Goal2.',
    kind: 'syntax',
    meta: 'conjunction',
    preview: '',
    detail: 'Both goals must succeed, left to right.',
    selection: [0, 5],
    keywords: ['and', 'both', 'comma'],
    weight: 18,
  },
  {
    id: 'teach-or',
    title: 'Goal1 ; Goal2.',
    insert: 'Goal1 ; Goal2.',
    kind: 'syntax',
    meta: 'disjunction',
    preview: '',
    detail: 'Either goal may succeed.',
    selection: [0, 5],
    keywords: ['or', 'either', 'semicolon'],
    weight: 17,
  },
  {
    id: 'teach-not',
    title: '\\+ Goal.',
    insert: '\\+ Goal.',
    kind: 'syntax',
    meta: 'negation',
    preview: '',
    detail: 'Succeeds when Goal cannot be proven.',
    selection: [3, 7],
    keywords: ['not', 'negation', 'failure'],
    weight: 16,
  },
  {
    id: 'teach-member',
    title: 'member(X, [a, b, c]).',
    insert: 'member(X, [a, b, c]).',
    kind: 'builtin',
    meta: 'lists',
    preview: '',
    detail: 'Ask whether X belongs to a list, or generate members.',
    selection: [7, 8],
    keywords: ['list', 'contains', 'iterate'],
    weight: 15,
  },
  {
    id: 'teach-append',
    title: 'append(Left, Right, Whole).',
    insert: 'append(Left, Right, Whole).',
    kind: 'builtin',
    meta: 'lists',
    preview: '',
    detail: 'Split a list or join two lists into one.',
    selection: [7, 11],
    keywords: ['list', 'concat', 'split'],
    weight: 14,
  },
  {
    id: 'teach-length',
    title: 'length(List, N).',
    insert: 'length(List, N).',
    kind: 'builtin',
    meta: 'lists',
    preview: '',
    detail: 'Relate a list to its length.',
    selection: [7, 11],
    keywords: ['list', 'size', 'count'],
    weight: 13,
  },
  {
    id: 'teach-findall',
    title: 'findall(X, Goal, List).',
    insert: 'findall(X, Goal, List).',
    kind: 'builtin',
    meta: 'collect solutions',
    preview: '',
    detail: 'Gather every solution for Goal into List.',
    selection: [8, 9],
    keywords: ['collect', 'all', 'solutions'],
    weight: 12,
  },
  {
    id: 'teach-var',
    title: 'var(X).',
    insert: 'var(X).',
    kind: 'builtin',
    meta: 'type test',
    preview: '',
    detail: 'True when X is still an unbound variable.',
    selection: [4, 5],
    keywords: ['variable', 'unbound'],
    weight: 10,
  },
  {
    id: 'teach-atom',
    title: 'atom(X).',
    insert: 'atom(X).',
    kind: 'builtin',
    meta: 'type test',
    preview: '',
    detail: 'True when X is an atom like ada or mars.',
    selection: [5, 6],
    keywords: ['atom', 'symbol'],
    weight: 9,
  },
]

/* ── Persistence ── */

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

let saveTimer

function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          source: state.source,
          query: state.query,
          presetId: state.activePresetId,
          split: state.splitPercent,
          resultsHeight: state.resultsHeight,
          predicatesHeight: state.predicatesHeight,
          history: queryHistory.slice(0, MAX_HISTORY),
          fileName: currentFileName,
        }),
      )
    } catch {}
  }, 400)
}

/* ── State ── */

const saved = loadSaved()
const savedPreset = PRESETS.find((preset) => preset.id === saved?.presetId) || null
const usingCustomSavedProgram = Boolean(saved?.source) && (saved?.presetId === '' || saved?.presetId == null)
const initialPreset = savedPreset || PRESETS[0]
const initialSource = usingCustomSavedProgram ? saved.source : initialPreset.program
const initialQuery = usingCustomSavedProgram ? saved?.query || '' : initialPreset.query

const state = reactive({
  activePresetId: usingCustomSavedProgram ? '' : initialPreset.id,
  source: initialSource,
  query: initialQuery,
  world: buildWorld(initialSource),
  results: [],
  runState: 'idle',
  error: '',
  statusLine: '',
  splitPercent: saved?.split ?? 50,
  resultsHeight: saved?.resultsHeight ?? 248,
  predicatesHeight: saved?.predicatesHeight ?? 248,
  autocompleteItems: [],
  autocompleteOpen: false,
  autocompleteIndex: 0,
  graphHoverType: '',
  graphHoverId: '',
  graphSelectedType: '',
  graphSelectedId: '',
})

const queryHistory = saved?.history ?? []
let historyIndex = -1
let historyDraft = ''
let currentFileName = saved?.fileName ?? 'program.pl'
let queryCursor = state.query.length
let graphDrag = null

/* ── World sync ── */

function syncWorld(program) {
  state.world = buildWorld(program)
  state.error = ''
  state.graphHoverType = ''
  state.graphHoverId = ''
  state.graphSelectedType = ''
  state.graphSelectedId = ''
  const s = state.world.stats
  state.statusLine = `${s.factCount} facts · ${s.entityCount} entities · ${s.predicateCount} predicates`
}

syncWorld(state.source)

/* ── Query autocomplete ── */

function getQueryInput() {
  return document.getElementById('query-input')
}

function closeAutocomplete() {
  state.autocompleteOpen = false
  state.autocompleteIndex = 0
}

function getCompletionContext(query, cursor) {
  let start = cursor
  let end = cursor

  while (start > 0 && !/[\s(),.;]/.test(query[start - 1])) {
    start -= 1
  }

  while (end < query.length && !/[\s(),.;]/.test(query[end])) {
    end += 1
  }

  return {
    start,
    end,
    token: query.slice(start, cursor),
  }
}

function splitTopLevelArgs(text) {
  const parts = []
  let buffer = ''
  let depth = 0
  let quote = null

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (quote) {
      buffer += character
      if (character === quote && text[index - 1] !== '\\') {
        quote = null
      }
      continue
    }

    if (character === '\'' || character === '"') {
      quote = character
      buffer += character
      continue
    }

    if (character === '(' || character === '[' || character === '{') {
      depth += 1
      buffer += character
      continue
    }

    if (character === ')' || character === ']' || character === '}') {
      depth = Math.max(0, depth - 1)
      buffer += character
      continue
    }

    if (character === ',' && depth === 0) {
      parts.push(buffer.trim())
      buffer = ''
      continue
    }

    buffer += character
  }

  parts.push(buffer.trim())
  return parts
}

function findMatchingParen(text, openIndex) {
  let depth = 0
  let quote = null

  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index]

    if (quote) {
      if (character === quote && text[index - 1] !== '\\') {
        quote = null
      }
      continue
    }

    if (character === '\'' || character === '"') {
      quote = character
      continue
    }

    if (character === '(') {
      depth += 1
      continue
    }

    if (character === ')') {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

function findCallContext(query, cursor) {
  let depth = 0
  let quote = null
  let openIndex = -1

  for (let index = cursor - 1; index >= 0; index -= 1) {
    const character = query[index]

    if (quote) {
      if (character === quote && query[index - 1] !== '\\') {
        quote = null
      }
      continue
    }

    if (character === '\'' || character === '"') {
      quote = character
      continue
    }

    if (character === ')') {
      depth += 1
      continue
    }

    if (character === '(') {
      if (depth === 0) {
        openIndex = index
        break
      }
      depth -= 1
    }
  }

  if (openIndex === -1) return null

  let nameEnd = openIndex
  let nameStart = nameEnd
  while (nameStart > 0 && /[A-Za-z0-9_]/.test(query[nameStart - 1])) {
    nameStart -= 1
  }

  const predicate = query.slice(nameStart, nameEnd).trim()
  if (!predicate || !/^[a-z][\w]*$/i.test(predicate)) return null

  const closeIndex = findMatchingParen(query, openIndex)
  const sliceEnd = closeIndex === -1 ? query.length : closeIndex
  const argText = query.slice(openIndex + 1, sliceEnd)
  const beforeCursor = query.slice(openIndex + 1, cursor)
  const argIndex = splitTopLevelArgs(beforeCursor).length - 1
  const args = splitTopLevelArgs(argText)

  return {
    predicate,
    argIndex: Math.max(0, argIndex),
    args,
  }
}

function normalizeQueryArg(text) {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function getPreviousSignificantChar(query, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!/\s/.test(query[cursor])) {
      return query[cursor]
    }
  }

  return ''
}

function getSyntaxContext(query, cursor) {
  const call = findCallContext(query, cursor)
  if (call) {
    return { mode: 'term', call }
  }

  const completion = getCompletionContext(query, cursor)
  const previous = getPreviousSignificantChar(query, completion.start)

  if (previous === '=' || previous === '[' || previous === '|') {
    return { mode: 'term', call: null }
  }

  return { mode: 'goal', call: null }
}

function isConcreteArgument(text) {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/^[_A-Z]/.test(trimmed)) return false
  return true
}

function formatQueryTerm(term) {
  if (/^-?\d+(?:\.\d+)?$/.test(term)) return term
  if (/^[a-z][\w]*$/.test(term)) return term
  return `'${term.replace(/'/g, "\\'")}'`
}

function ordinalLabel(index) {
  if (index === 1) return '1st arg'
  if (index === 2) return '2nd arg'
  if (index === 3) return '3rd arg'
  return `${index}th arg`
}

function variableNamesForArity(arity) {
  return Array.from({ length: arity }, (_, index) => ['A', 'B', 'C', 'D', 'E', 'F'][index] || `X${index + 1}`)
}

function tupleLabel(arity) {
  if (arity === 1) return 'value'
  if (arity === 2) return 'pair'
  if (arity === 3) return 'triple'
  return 'result'
}

function describePredicateSuggestion(predicate) {
  const facts = state.world.facts.filter(
    (fact) => fact.predicate === predicate.name && fact.arity === predicate.arity,
  )

  if (predicate.arity === 0) {
    return {
      meta: `${predicate.count} success${predicate.count === 1 ? '' : 'es'}`,
      preview: '',
      detail: 'succeeds if true',
    }
  }

  const variableNames = variableNamesForArity(predicate.arity)
  const firstFact = facts[0]
  const countLabel = `${predicate.count} ${tupleLabel(predicate.arity)}${predicate.count === 1 ? '' : 's'}`

  if (!firstFact) {
    return {
      meta: countLabel,
      preview: '',
      detail: 'matching bindings',
    }
  }

  const preview = firstFact.args
    .map((arg, index) => `${variableNames[index]} = ${arg}`)
    .join(', ')

  return {
    meta: countLabel,
    preview,
    detail: 'example result',
  }
}

function getPredicateSuggestions() {
  return state.world.predicates.map((predicate) => {
    const description = describePredicateSuggestion(predicate)

    return {
      id: `predicate:${predicate.id}`,
      title: predicate.query,
      insert: predicate.query,
      kind: 'query',
      meta: description.meta,
      preview: description.preview,
      detail: description.detail,
      selection: null,
      keywords: [predicate.name, predicate.sample, description.meta, description.preview],
      weight: 40 + predicate.count,
    }
  })
}

function buildArgumentValueSuggestions(call, token) {
  if (!call) return []

  const matchingFacts = state.world.facts.filter((fact) => {
    if (fact.predicate !== call.predicate) return false
    if (fact.arity <= call.argIndex) return false

    for (let index = 0; index < call.args.length; index += 1) {
      if (index === call.argIndex) continue
      const rawArg = call.args[index] || ''
      if (!isConcreteArgument(rawArg)) continue
      if (fact.args[index] !== normalizeQueryArg(rawArg)) {
        return false
      }
    }

    return true
  })

  const byValue = new Map()

  matchingFacts.forEach((fact) => {
    const value = fact.args[call.argIndex]
    if (!value) return
    const existing = byValue.get(value)
    if (existing) {
      existing.count += 1
      return
    }

    const previewArgs = fact.args.map((arg, index) => {
      const rawArg = call.args[index] || ''
      if (index === call.argIndex) return formatQueryTerm(value)
      if (isConcreteArgument(rawArg)) return formatQueryTerm(normalizeQueryArg(rawArg))
      return formatQueryTerm(arg)
    })

    byValue.set(value, {
      id: `arg:${call.predicate}:${call.argIndex}:${value}`,
      title: formatQueryTerm(value),
      insert: formatQueryTerm(value),
      kind: 'value',
      meta: ordinalLabel(call.argIndex + 1),
      preview: `${call.predicate}(${previewArgs.join(', ')})`,
      detail: 'from program',
      selection: null,
      keywords: [call.predicate, value, previewArgs.join(', ')],
      weight: 160,
      count: 1,
    })
  })

  return Array.from(byValue.values())
    .map((item) => ({
      ...item,
      weight: item.weight + item.count,
    }))
    .map(({ count, ...item }) => item)
    .map((item) => ({
      ...item,
      score: scoreSuggestion(item, token),
    }))
    .filter((item) => item.score >= 0)
}

function getVariableSuggestions(query, token) {
  const matches = Array.from(new Set(query.match(/\b[_A-Z][A-Za-z0-9_]*\b/g) || []))
    .filter((name) => name !== '_')
    .map((name) => ({
      id: `var:${name}`,
      title: name,
      insert: name,
      kind: 'var',
      meta: 'variable',
      preview: '',
      detail: 'reuse variable',
      selection: null,
      keywords: [name],
      weight: 120,
    }))

  return matches
    .map((item) => ({ ...item, score: scoreSuggestion(item, token) }))
    .filter((item) => item.score >= 0)
}

function getGenericTermSuggestions(token) {
  const placeholders = [
    {
      id: 'term:X',
      title: 'X',
      insert: 'X',
      kind: 'var',
      meta: 'variable',
      preview: '',
      detail: 'new variable',
      selection: null,
      keywords: ['variable'],
      weight: 90,
    },
    {
      id: 'term:_',
      title: '_',
      insert: '_',
      kind: 'var',
      meta: 'anonymous',
      preview: '',
      detail: 'ignore this value',
      selection: null,
      keywords: ['anonymous', 'ignore'],
      weight: 88,
    },
    {
      id: 'term:[]',
      title: '[]',
      insert: '[]',
      kind: 'term',
      meta: 'empty list',
      preview: '',
      detail: 'list literal',
      selection: null,
      keywords: ['list', 'empty'],
      weight: 86,
    },
    {
      id: 'term:[Head|Tail]',
      title: '[Head|Tail]',
      insert: '[Head|Tail]',
      kind: 'term',
      meta: 'list pattern',
      preview: '',
      detail: 'head / tail list',
      selection: [1, 5],
      keywords: ['list', 'head', 'tail'],
      weight: 84,
    },
  ]

  const atoms = Array.from(new Set(state.world.entityNodes.map((node) => node.label)))
    .map((label) => ({
      id: `atom:${label}`,
      title: formatQueryTerm(label),
      insert: formatQueryTerm(label),
      kind: 'atom',
      meta: 'atom',
      preview: '',
      detail: 'value from program',
      selection: null,
      keywords: [label],
      weight: 70,
    }))

  return [...placeholders, ...atoms]
    .map((item) => ({ ...item, score: scoreSuggestion(item, token) }))
    .filter((item) => item.score >= 0)
}

function getTermSuggestions(query, cursor) {
  const syntax = getSyntaxContext(query, cursor)
  const context = getCompletionContext(query, cursor)
  const token = /^[_A-Z]/.test(context.token.trim()) ? '' : context.token

  const specific = buildArgumentValueSuggestions(syntax.call, token)
  const variables = getVariableSuggestions(query, token)
  const generic = getGenericTermSuggestions(token)

  const deduped = new Map()

  ;[...specific, ...variables, ...generic].forEach((item) => {
    const key = `${item.kind}:${item.title}`
    if (!deduped.has(key)) {
      deduped.set(key, item)
    }
  })

  return Array.from(deduped.values())
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, MAX_SUGGESTIONS)
}

function scoreSuggestion(suggestion, token) {
  if (!token) return suggestion.weight

  const needle = token.toLowerCase()
  const title = suggestion.title.toLowerCase()
  const meta = suggestion.meta.toLowerCase()
  const detail = suggestion.detail.toLowerCase()
  const keywords = (suggestion.keywords || []).join(' ').toLowerCase()

  if (title.startsWith(needle)) return suggestion.weight + 100
  if (meta.startsWith(needle)) return suggestion.weight + 80
  if (title.includes(needle)) return suggestion.weight + 60
  if (meta.includes(needle)) return suggestion.weight + 40
  if (detail.includes(needle) || keywords.includes(needle)) return suggestion.weight + 20
  return -1
}

function buildAutocompleteSuggestions(query, cursor) {
  const context = getCompletionContext(query, cursor)
  const syntax = getSyntaxContext(query, cursor)

  if (syntax.mode === 'term') {
    return getTermSuggestions(query, cursor)
  }

  const pool = [...getPredicateSuggestions(), ...PROLOG_TEACHING_SNIPPETS]

  return pool
    .map((item) => ({
      ...item,
      score: scoreSuggestion(item, context.token),
    }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, MAX_SUGGESTIONS)
}

function refreshAutocomplete(input, forceOpen = true) {
  const field = input || getQueryInput()
  queryCursor = field?.selectionStart ?? state.query.length
  const nextItems = buildAutocompleteSuggestions(state.query, queryCursor)

  state.autocompleteItems = nextItems

  if (!nextItems.length) {
    closeAutocomplete()
    return
  }

  if (forceOpen) {
    state.autocompleteOpen = true
  }

  state.autocompleteIndex = Math.max(0, Math.min(state.autocompleteIndex, nextItems.length - 1))
  scrollActiveAutocompleteIntoView()
}

function focusQueryInput(selectionStart, selectionEnd = selectionStart) {
  requestAnimationFrame(() => {
    const input = getQueryInput()
    if (!input) return
    input.focus()
    input.setSelectionRange(selectionStart, selectionEnd)
  })
}

function scrollActiveAutocompleteIntoView() {
  requestAnimationFrame(() => {
    const activeItem = document.querySelector(`[data-autocomplete-index="${state.autocompleteIndex}"]`)
    if (!activeItem || typeof activeItem.scrollIntoView !== 'function') return
    activeItem.scrollIntoView({ block: 'nearest' })
  })
}

function applyAutocomplete(item) {
  const input = getQueryInput()
  const cursor = input?.selectionStart ?? queryCursor
  const context = getCompletionContext(state.query, cursor)
  const nextQuery = `${state.query.slice(0, context.start)}${item.insert}${state.query.slice(context.end)}`

  state.query = nextQuery
  state.error = ''
  historyIndex = -1
  closeAutocomplete()
  persist()

  const start = context.start + (item.selection ? item.selection[0] : item.insert.length)
  const end = context.start + (item.selection ? item.selection[1] : item.insert.length)
  focusQueryInput(start, end)
}

function chooseAutocomplete(item, event) {
  event.preventDefault()
  event.stopPropagation()
  applyAutocomplete(item)
}

/* ── Actions ── */

function selectPreset(preset) {
  state.activePresetId = preset.id
  state.source = preset.program
  state.query = preset.query
  state.results = []
  state.runState = 'idle'
  currentFileName = `${preset.id}.pl`
  syncWorld(preset.program)
  closeAutocomplete()
  persist()
}

function usePredicateQuery(predicate) {
  state.query = predicate.query
  state.error = ''
  closeAutocomplete()
  persist()
  focusQueryInput(state.query.length)
}

function handleSourceInput(event) {
  state.source = event.target.value
  if (state.activePresetId) {
    const preset = PRESETS.find((p) => p.id === state.activePresetId)
    if (preset && state.source !== preset.program) {
      state.activePresetId = ''
    }
  }
  syncWorld(state.source)
  persist()
}

function handleQueryInput(event) {
  state.query = event.target.value
  state.error = ''
  historyIndex = -1
  state.autocompleteIndex = 0
  refreshAutocomplete(event.target)
  persist()
}

function handleQueryFocus(event) {
  refreshAutocomplete(event.target)
}

function handleQueryClick(event) {
  refreshAutocomplete(event.target)
}

function handleQueryBlur() {
  setTimeout(() => {
    closeAutocomplete()
  }, 120)
}

function handleQueryKeydown(event) {
  const hasAutocomplete = state.autocompleteOpen && state.autocompleteItems.length > 0

  if (hasAutocomplete && event.key === 'ArrowDown') {
    event.preventDefault()
    state.autocompleteIndex = (state.autocompleteIndex + 1) % state.autocompleteItems.length
    scrollActiveAutocompleteIntoView()
    return
  }

  if (hasAutocomplete && event.key === 'ArrowUp') {
    event.preventDefault()
    state.autocompleteIndex =
      (state.autocompleteIndex - 1 + state.autocompleteItems.length) % state.autocompleteItems.length
    scrollActiveAutocompleteIntoView()
    return
  }

  if (hasAutocomplete && (event.key === 'Tab' || event.key === 'Enter')) {
    event.preventDefault()
    applyAutocomplete(state.autocompleteItems[state.autocompleteIndex])
    return
  }

  if (hasAutocomplete && event.key === 'Escape') {
    event.preventDefault()
    closeAutocomplete()
    return
  }

  if (event.key === 'ArrowUp' && queryHistory.length > 0) {
    event.preventDefault()
    if (historyIndex === -1) historyDraft = state.query
    if (historyIndex < queryHistory.length - 1) {
      historyIndex += 1
      state.query = queryHistory[historyIndex]
      closeAutocomplete()
      focusQueryInput(state.query.length)
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (historyIndex > 0) {
      historyIndex -= 1
      state.query = queryHistory[historyIndex]
      closeAutocomplete()
      focusQueryInput(state.query.length)
    } else if (historyIndex === 0) {
      historyIndex = -1
      state.query = historyDraft
      closeAutocomplete()
      focusQueryInput(state.query.length)
    }
  }
}

function handleEditorKeydown(event) {
  if (event.key === 'Tab') {
    event.preventDefault()
    const el = event.target
    const start = el.selectionStart
    const end = el.selectionEnd

    if (event.shiftKey) {
      const lineStart = el.value.lastIndexOf('\n', start - 1) + 1
      if (el.value.substring(lineStart, lineStart + 2) === '  ') {
        el.value = el.value.substring(0, lineStart) + el.value.substring(lineStart + 2)
        el.selectionStart = el.selectionEnd = Math.max(lineStart, start - 2)
      }
    } else {
      el.value = el.value.substring(0, start) + '  ' + el.value.substring(end)
      el.selectionStart = el.selectionEnd = start + 2
    }

    state.source = el.value
    syncWorld(state.source)
    persist()

    const cursor = el.selectionStart
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = cursor
    })
  }
}

async function executeQuery(event) {
  if (event && event.preventDefault) event.preventDefault()

  const q = state.query.trim()
  if (!q) return

  if (queryHistory[0] !== q) {
    queryHistory.unshift(q)
    if (queryHistory.length > MAX_HISTORY) queryHistory.pop()
  }
  historyIndex = -1
  closeAutocomplete()

  state.runState = 'running'
  state.error = ''
  state.results = []

  try {
    const answers = await runQuery(state.source, state.query)

    if (answers.length === 0) {
      state.runState = 'empty'
      state.results = ['false.']
      persist()
      return
    }

    state.runState = 'ok'
    state.results = answers
  } catch (error) {
    state.runState = 'error'
    state.error = error.message
    state.results = []
  }

  persist()
}

/* ── File operations ── */

function openFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.pl,.pro,.prolog,.txt'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) importFile(file)
  }
  input.click()
}

function importFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    currentFileName = file.name
    state.source = String(reader.result ?? '')
    state.activePresetId = ''
    state.results = []
    state.runState = 'idle'
    state.query = ''
    syncWorld(state.source)
    state.statusLine = `Loaded ${file.name}`
    closeAutocomplete()
    persist()
  }
  reader.readAsText(file)
}

function saveFile() {
  const blob = new Blob([state.source], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = currentFileName
  a.click()
  URL.revokeObjectURL(url)
  state.statusLine = `Saved ${currentFileName}`
}

/* ── Graph interaction ── */

function getPredicateByName(name) {
  return state.world.predicates.find((predicate) => predicate.name === name) || null
}

function setGraphHover(type, id) {
  state.graphHoverType = type
  state.graphHoverId = id
}

function clearGraphHover() {
  state.graphHoverType = ''
  state.graphHoverId = ''
}

function toggleGraphSelection(type, id) {
  if (state.graphSelectedType === type && state.graphSelectedId === id) {
    state.graphSelectedType = ''
    state.graphSelectedId = ''
    return false
  }

  state.graphSelectedType = type
  state.graphSelectedId = id
  return true
}

function applyQuery(query) {
  state.query = query
  closeAutocomplete()
  persist()
  focusQueryInput(state.query.length)
}

function queryForEntity(name) {
  const related = state.world.facts.filter((fact) => fact.args.includes(name))
  if (!related.length) return ''

  const fact = related.find((item) => item.arity > 1) || related[0]
  const queryArgs = fact.args.map((arg, index) => (arg === name ? name : String.fromCharCode(65 + index)))
  return `${fact.predicate}(${queryArgs.join(', ')}).`
}

function queryForPredicateName(name) {
  return getPredicateByName(name)?.query || ''
}

function handleNodeClick(node) {
  const isActive = toggleGraphSelection('node', node.id)
  if (!isActive) return

  if (node.kind === 'relation') {
    const predicateName = node.label.split('/')[0]
    const query = queryForPredicateName(predicateName)
    if (query) applyQuery(query)
    return
  }

  const query = queryForEntity(node.label)
  if (query) applyQuery(query)
}

function handleEdgeClick(edge) {
  const isActive = toggleGraphSelection('edge', edge.id)
  if (!isActive) return

  const query = queryForPredicateName(edge.label)
  if (query) applyQuery(query)
}

function getActiveGraphTarget() {
  const type = state.graphHoverType || state.graphSelectedType
  const id = state.graphHoverId || state.graphSelectedId
  return type && id ? { type, id } : null
}

function buildGraphFocus() {
  const active = getActiveGraphTarget()
  if (!active) return null

  if (active.type === 'node') {
    const node = state.world.nodeLookup[active.id]
    if (!node) return null

    const edges = state.world.edges.filter(
      (edge) => edge.source === node.id || edge.target === node.id,
    )
    const highlightEdgeIds = new Set(edges.map((edge) => edge.id))
    const highlightNodeIds = new Set([node.id])

    edges.forEach((edge) => {
      highlightNodeIds.add(edge.source)
      highlightNodeIds.add(edge.target)
    })

    if (node.kind === 'relation') {
      return {
        type: 'node',
        title: node.label,
        meta: `${edges.length} connection${edges.length === 1 ? '' : 's'}`,
        summary: edges.map((edge) => state.world.nodeLookup[edge.target]?.label || state.world.nodeLookup[edge.source]?.label).filter(Boolean).join(' · '),
        query: queryForPredicateName(node.label.split('/')[0]),
        highlightNodeIds,
        highlightEdgeIds,
      }
    }

    const tags = node.tags.length ? node.tags.join(' · ') : 'entity'
    const linkedPredicates = Array.from(new Set(edges.map((edge) => edge.label))).join(' · ')

    return {
      type: 'node',
      title: node.label,
      meta: tags,
      summary: linkedPredicates || 'no links',
      query: queryForEntity(node.label),
      highlightNodeIds,
      highlightEdgeIds,
    }
  }

  if (active.type === 'edge') {
    const edge = state.world.edges.find((item) => item.id === active.id)
    if (!edge) return null

    const source = state.world.nodeLookup[edge.source]
    const target = state.world.nodeLookup[edge.target]
    const highlightNodeIds = new Set([edge.source, edge.target])
    const highlightEdgeIds = new Set([edge.id])

    return {
      type: 'edge',
      title: edge.label,
      meta: edge.kind === 'compound' ? 'compound relation' : 'binary relation',
      summary: `${source?.label || '?'} → ${target?.label || '?'}`,
      query: queryForPredicateName(edge.label),
      highlightNodeIds,
      highlightEdgeIds,
    }
  }

  return null
}

function graphNodeClass(node, focus) {
  const isActive = focus?.highlightNodeIds?.has(node.id)
  const hasFocus = Boolean(focus)
  const isDragging = graphDrag?.nodeId === node.id
  const base = isDragging ? 'node node--dragging' : 'node node--click'
  return hasFocus
    ? isActive
      ? `${base} is-active`
      : `${base} is-dim`
    : base
}

function graphRelationClass(node, focus) {
  const isActive = focus?.highlightNodeIds?.has(node.id)
  const hasFocus = Boolean(focus)
  const isDragging = graphDrag?.nodeId === node.id
  const base = isDragging ? 'relation relation--click relation--dragging' : 'relation relation--click'
  return hasFocus
    ? isActive
      ? `${base} is-active`
      : `${base} is-dim`
    : base
}

function graphEdgeClass(edge, focus) {
  const base = edge.kind === 'compound' ? 'edge edge--compound' : 'edge'
  const isActive = focus?.highlightEdgeIds?.has(edge.id)
  const hasFocus = Boolean(focus)
  return hasFocus ? (isActive ? `${base} is-active` : `${base} is-dim`) : base
}

function graphInspector() {
  return html`
    <div class="graph-inspector">
      ${() => {
        const focus = buildGraphFocus()
        const title = focus?.title || 'Interactive graph'
        const meta = focus?.meta || 'hover, drag, or click'
        const summary = focus?.summary || 'Drag nodes to rearrange the graph. Hover to trace connected facts. Click a node or edge to pin it and load a related query.'
        const query = focus?.query || ''

        return html`
          <div class="graph-inspector__top">
            <strong class="graph-inspector__title">${title}</strong>
            <span class="graph-inspector__meta">${meta}</span>
          </div>
          <div class="graph-inspector__summary">${summary}</div>
          <code class="${query ? 'graph-inspector__query' : 'graph-inspector__query is-empty'}">${query || '—'}</code>
        `
      }}
    </div>
  `
}

function getGraphPointFromClient(clientX, clientY) {
  const svgEl = document.querySelector('.graph-svg')
  if (!svgEl) return { x: 0, y: 0 }

  const rect = svgEl.getBoundingClientRect()
  return {
    x: ((clientX - rect.left) / rect.width) * 780,
    y: ((clientY - rect.top) / rect.height) * 640,
  }
}

function setNodePosition(nodeId, x, y) {
  const clampX = Math.min(740, Math.max(40, x))
  const clampY = Math.min(600, Math.max(40, y))
  const update = (node) => (node.id === nodeId ? { ...node, x: clampX, y: clampY } : node)

  const entityNodes = state.world.entityNodes.map(update)
  const relationNodes = state.world.relationNodes.map(update)
  const nodes = [...entityNodes, ...relationNodes]
  const nodeLookup = Object.fromEntries(nodes.map((node) => [node.id, node]))

  state.world = {
    ...state.world,
    entityNodes,
    relationNodes,
    nodes,
    nodeLookup,
  }
}

function beginNodeInteraction(node, event) {
  if (event.button !== 0) return

  event.preventDefault()
  event.stopPropagation()

  const start = getGraphPointFromClient(event.clientX, event.clientY)
  graphDrag = {
    nodeId: node.id,
    startX: start.x,
    startY: start.y,
    originX: node.x,
    originY: node.y,
    moved: false,
  }

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'grabbing'

  const onMove = (moveEvent) => {
    if (!graphDrag || graphDrag.nodeId !== node.id) return

    const next = getGraphPointFromClient(moveEvent.clientX, moveEvent.clientY)
    const dx = next.x - graphDrag.startX
    const dy = next.y - graphDrag.startY

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      graphDrag.moved = true
    }

    setNodePosition(node.id, graphDrag.originX + dx, graphDrag.originY + dy)
  }

  const onUp = () => {
    const wasDrag = graphDrag?.moved
    graphDrag = null
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)

    if (!wasDrag) {
      const currentNode = state.world.nodeLookup[node.id]
      if (currentNode) {
        handleNodeClick(currentNode)
      }
    }
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/* ── Graph rendering ── */

function edgePath(edge, lookup) {
  const source = lookup[edge.source]
  const target = lookup[edge.target]
  if (!source || !target) return ''

  const dx = target.x - source.x
  const dy = target.y - source.y
  const distance = Math.max(1, Math.hypot(dx, dy))
  const curve = edge.kind === 'binary' ? 24 : 14
  const cx = source.x + dx / 2 + (-dy / distance) * curve
  const cy = source.y + dy / 2 + (dx / distance) * curve

  return `M ${source.x} ${source.y} Q ${cx} ${cy} ${target.x} ${target.y}`
}

function edgeLabelPos(edge, lookup) {
  const source = lookup[edge.source]
  const target = lookup[edge.target]
  if (!source || !target) return { x: 0, y: 0 }

  return {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2 - (edge.kind === 'binary' ? 10 : 5),
  }
}

function worldGraph() {
  const graph = svg`
    <svg viewBox="0 0 780 640" class="graph-svg">
      ${() => {
        const focus = buildGraphFocus()

        return state.world.edges.map((edge) => {
          const labelPos = edgeLabelPos(edge, state.world.nodeLookup)

          return svg`
            <g
              class="graph-edge-hit"
              @mouseenter="${() => setGraphHover('edge', edge.id)}"
              @mouseleave="${clearGraphHover}"
              @click="${() => handleEdgeClick(edge)}"
            >
              <path class="${graphEdgeClass(edge, focus)}" d="${edgePath(edge, state.world.nodeLookup)}"></path>
              <text class="edge-label" x="${labelPos.x}" y="${labelPos.y}">${edge.label}</text>
            </g>
          `.key(edge.id)
        })
      }}

      ${() => {
        const focus = buildGraphFocus()

        return state.world.entityNodes.map((node) => svg`
          <g
            class="${graphNodeClass(node, focus)}"
            transform="${`translate(${node.x} ${node.y})`}"
            @mouseenter="${() => setGraphHover('node', node.id)}"
            @mouseleave="${clearGraphHover}"
            @mousedown="${(event) => beginNodeInteraction(node, event)}"
          >
            <circle r="24"></circle>
            <text class="node-label" y="1">${node.label}</text>
            <text class="node-tags" y="14">${node.tags.join(' · ')}</text>
          </g>
        `.key(node.id))
      }}

      ${() => {
        const focus = buildGraphFocus()

        return state.world.relationNodes.map((node) => svg`
          <g
            class="${graphRelationClass(node, focus)}"
            transform="${`translate(${node.x} ${node.y})`}"
            @mouseenter="${() => setGraphHover('node', node.id)}"
            @mouseleave="${clearGraphHover}"
            @mousedown="${(event) => beginNodeInteraction(node, event)}"
          >
            <rect x="-38" y="-13" width="76" height="26" rx="4"></rect>
            <text class="relation-label" y="4">${node.label}</text>
          </g>
        `.key(node.id))
      }}
    </svg>
  `

  return html`
    <div class="graph-wrap">${graph}</div>
    ${graphInspector()}
  `
}

/* ── App template ── */

const app = html`
  <div class="app">
    <header class="toolbar">
      <span class="toolbar__title">HelloProlog</span>
      <span class="toolbar__sep"></span>
      <button class="toolbar__btn" title="Open .pl file (⌘O)" @click="${openFile}">Open</button>
      <button class="toolbar__btn" title="Save as .pl (⌘S)" @click="${saveFile}">Save</button>
      <span class="toolbar__sep"></span>
      <nav class="toolbar__presets">
        ${PRESETS.map((preset) => html`
          <button
            class="${() => (state.activePresetId === preset.id ? 'preset-tab is-active' : 'preset-tab')}"
            @click="${() => selectPreset(preset)}"
          >${preset.name}</button>
        `.key(preset.id))}
      </nav>
      <span class="toolbar__status">${() => state.statusLine}</span>
    </header>

    <div class="workspace" id="workspace">
      <div class="pane pane--left">
        <div class="${() => (state.autocompleteOpen && state.autocompleteItems.length ? 'query-stack is-open' : 'query-stack')}">
          <form class="query-bar" @submit="${executeQuery}">
            <span class="query-bar__prompt">?-</span>
            <input
              id="query-input"
              class="query-input"
              type="text"
              placeholder="type a goal…"
              value="${() => state.query}"
              @input="${handleQueryInput}"
              @keydown="${handleQueryKeydown}"
              @focus="${handleQueryFocus}"
              @click="${handleQueryClick}"
              @blur="${handleQueryBlur}"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            />
            <button class="query-bar__run" type="submit">${() => (state.runState === 'running' ? '…' : 'Run')}</button>
          </form>

          ${() =>
            state.autocompleteOpen && state.autocompleteItems.length
              ? html`
                  <section class="autocomplete-panel">
                    <header class="autocomplete-panel__header">
                      <span>Intellisense</span>
                      <small>↑ ↓ navigate · Tab accept · ↵ insert</small>
                    </header>
                    <div class="autocomplete-list">
                      ${state.autocompleteItems.map((item, index) => html`
                        <button
                          class="${() => (state.autocompleteIndex === index ? 'autocomplete-item is-active' : 'autocomplete-item')}"
                          data-autocomplete-index="${index}"
                          @click="${(event) => chooseAutocomplete(item, event)}"
                          type="button"
                        >
                          <span class="autocomplete-item__kind">${item.kind}</span>
                          <span class="autocomplete-item__body">
                            <span class="autocomplete-item__top">
                              <strong class="autocomplete-item__title">${item.title}</strong>
                              <small class="autocomplete-item__meta">${item.meta}</small>
                            </span>
                            ${item.preview
                              ? html`<code class="autocomplete-item__secondary autocomplete-item__secondary--code">${item.preview}</code>`
                              : html`<span class="autocomplete-item__secondary">${item.detail}</span>`}
                          </span>
                        </button>
                      `.key(item.id))}
                    </div>
                  </section>
                `
              : ''}
        </div>

        <div class="section section--editor">
          <label class="section__label">Program</label>
          <textarea
            class="editor"
            spellcheck="false"
            .value="${() => state.source}"
            @input="${handleSourceInput}"
            @keydown="${handleEditorKeydown}"
          ></textarea>
        </div>

        <div class="section-resizer" id="results-resizer" aria-hidden="true"></div>

        <div class="section section--results" id="results-section">
          <div class="section__head">
            <label class="section__label">Results</label>
            <span class="section__meta">${() => (state.runState === 'idle' ? '⌘↵' : state.runState)}</span>
          </div>
          ${() => (state.error ? html`<div class="error-line">${state.error}</div>` : '')}
          <ol class="results">
            ${() =>
              state.results.map((line, index) => html`<li class="result-line">${line}</li>`.key(`r-${index}-${line}`))}
          </ol>
        </div>
      </div>

      <div class="pane-resizer" id="resizer"></div>

      <div class="pane pane--right">
        <div class="section section--graph">
          <label class="section__label">Graph</label>
          ${worldGraph()}
        </div>

        <div class="section-resizer" id="predicates-resizer" aria-hidden="true"></div>

        <div class="section section--predicates" id="predicates-section">
          <div class="section__head">
            <label class="section__label">Predicates</label>
            <span class="section__meta">${() => state.world.predicates.length}</span>
          </div>
          <div class="predicate-list">
            ${() =>
              state.world.predicates.map((predicate) => html`
                <button class="predicate-row" @click="${() => usePredicateQuery(predicate)}">
                  <code class="predicate-row__name">${predicate.name}/${predicate.arity}</code>
                  <span class="predicate-row__count">${predicate.count}</span>
                </button>
              `.key(predicate.id))}
          </div>
        </div>
      </div>
    </div>

    <div class="drop-overlay" id="drop-overlay">
      <span>Drop .pl file to load</span>
    </div>
  </div>
`

/* ── Mount ── */

const root = document.getElementById('app')
if (!root) throw new Error('Missing #app root')
app(root)

/* ── Auto-run seeded query ── */

if (state.query.trim()) {
  executeQuery({ preventDefault() {} })
}

/* ── Keyboard shortcuts ── */

document.addEventListener('keydown', (event) => {
  const mod = event.metaKey || event.ctrlKey

  if (mod && event.key === 'Enter') {
    event.preventDefault()
    executeQuery({ preventDefault() {} })
  } else if (mod && event.key === 'o') {
    event.preventDefault()
    openFile()
  } else if (mod && event.key === 's') {
    event.preventDefault()
    saveFile()
  }
})

/* ── Drag & drop ── */

const dropOverlay = document.getElementById('drop-overlay')
let dragCounter = 0

document.addEventListener('dragenter', (event) => {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault()
    dragCounter += 1
    dropOverlay.classList.add('is-visible')
  }
})

document.addEventListener('dragover', (event) => {
  event.preventDefault()
})

document.addEventListener('dragleave', () => {
  dragCounter -= 1
  if (dragCounter <= 0) {
    dragCounter = 0
    dropOverlay.classList.remove('is-visible')
  }
})

document.addEventListener('drop', (event) => {
  event.preventDefault()
  dragCounter = 0
  dropOverlay.classList.remove('is-visible')

  const file = event.dataTransfer?.files[0]
  if (file && /\.(pl|pro|prolog|txt)$/i.test(file.name)) {
    importFile(file)
  }
})

/* ── Pane resizer ── */

const resizer = document.getElementById('resizer')
const workspace = document.getElementById('workspace')
const resultsSection = document.getElementById('results-section')
const predicatesSection = document.getElementById('predicates-section')
const resultsResizer = document.getElementById('results-resizer')
const predicatesResizer = document.getElementById('predicates-resizer')

function applyBottomSectionHeights() {
  if (resultsSection) {
    resultsSection.style.height = `${state.resultsHeight}px`
  }

  if (predicatesSection) {
    predicatesSection.style.height = `${state.predicatesHeight}px`
  }
}

function wireBottomResizer(resizerEl, sectionEl, paneSelector, stateKey) {
  if (!resizerEl || !sectionEl) return

  resizerEl.addEventListener('mousedown', (event) => {
    event.preventDefault()
    const pane = resizerEl.closest(paneSelector)
    if (!pane) return

    const paneRect = pane.getBoundingClientRect()

    const onMove = (moveEvent) => {
      const nextHeight = paneRect.bottom - moveEvent.clientY
      const maxHeight = Math.min(360, paneRect.height * 0.45)
      const clamped = Math.round(Math.max(140, Math.min(maxHeight, nextHeight)))
      state[stateKey] = clamped
      sectionEl.style.height = `${clamped}px`
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      persist()
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}

applyBottomSectionHeights()
wireBottomResizer(resultsResizer, resultsSection, '.pane--left', 'resultsHeight')
wireBottomResizer(predicatesResizer, predicatesSection, '.pane--right', 'predicatesHeight')

if (resizer && workspace) {
  if (state.splitPercent !== 50) {
    workspace.style.gridTemplateColumns = `${state.splitPercent}fr 5px ${100 - state.splitPercent}fr`
  }

  resizer.addEventListener('mousedown', (event) => {
    event.preventDefault()
    const rect = workspace.getBoundingClientRect()

    const onMove = (moveEvent) => {
      const x = moveEvent.clientX - rect.left
      const pct = Math.min(75, Math.max(25, (x / rect.width) * 100))
      workspace.style.gridTemplateColumns = `${pct}fr 5px ${100 - pct}fr`
      state.splitPercent = Math.round(pct)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      persist()
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}
