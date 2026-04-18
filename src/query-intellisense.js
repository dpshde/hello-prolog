import { makePredicateGoal } from './prolog.js'
import { getTauProlog } from './tau-prolog-loader.js'

const pl = getTauProlog()

const WORD_DELIMITERS = /[\s(),.;[\]{}|]/
const OPERATOR_CHARS = /[!#$%&*+\-/:<=>?@\\^~]/
const WORD_OPERATORS = new Set(['is'])

const BUILTIN_PREDICATES = [
  {
    id: 'builtin:true/0',
    name: 'true',
    arity: 0,
    argKinds: [],
    meta: 'control',
    detail: 'always succeeds',
    weight: 76,
  },
  {
    id: 'builtin:fail/0',
    name: 'fail',
    arity: 0,
    argKinds: [],
    meta: 'control',
    detail: 'always fails',
    weight: 72,
  },
  {
    id: 'builtin:member/2',
    name: 'member',
    arity: 2,
    argKinds: ['term', 'term'],
    meta: 'lists',
    detail: 'membership in a list',
    weight: 68,
  },
  {
    id: 'builtin:append/3',
    name: 'append',
    arity: 3,
    argKinds: ['term', 'term', 'term'],
    meta: 'lists',
    detail: 'join or split lists',
    weight: 64,
  },
  {
    id: 'builtin:length/2',
    name: 'length',
    arity: 2,
    argKinds: ['term', 'term'],
    meta: 'lists',
    detail: 'relate a list to its length',
    weight: 62,
  },
  {
    id: 'builtin:findall/3',
    name: 'findall',
    arity: 3,
    argKinds: ['term', 'goal', 'term'],
    meta: 'collect solutions',
    detail: 'gather every solution into a list',
    weight: 70,
  },
  {
    id: 'builtin:bagof/3',
    name: 'bagof',
    arity: 3,
    argKinds: ['term', 'goal', 'term'],
    meta: 'collect solutions',
    detail: 'gather solutions with duplicates',
    weight: 58,
  },
  {
    id: 'builtin:setof/3',
    name: 'setof',
    arity: 3,
    argKinds: ['term', 'goal', 'term'],
    meta: 'collect solutions',
    detail: 'gather sorted unique solutions',
    weight: 58,
  },
  {
    id: 'builtin:once/1',
    name: 'once',
    arity: 1,
    argKinds: ['goal'],
    meta: 'control',
    detail: 'commit to the first solution',
    weight: 60,
  },
  {
    id: 'builtin:var/1',
    name: 'var',
    arity: 1,
    argKinds: ['term'],
    meta: 'type test',
    detail: 'true when the term is unbound',
    weight: 56,
  },
  {
    id: 'builtin:atom/1',
    name: 'atom',
    arity: 1,
    argKinds: ['term'],
    meta: 'type test',
    detail: 'true when the term is an atom',
    weight: 54,
  },
]

const GOAL_SYNTAX_SUGGESTIONS = [
  {
    id: 'syntax:not',
    title: '\\+ Goal',
    insert: '\\+ Goal',
    kind: 'syntax',
    meta: 'negation',
    detail: 'succeeds when Goal cannot be proven',
    selection: [3, 7],
    weight: 66,
  },
  {
    id: 'syntax:group',
    title: '(Goal)',
    insert: '(Goal)',
    kind: 'syntax',
    meta: 'group',
    detail: 'group goals before , or ;',
    selection: [1, 5],
    weight: 50,
  },
]

export function createQueryIntellisense() {
  let cachedProgram = null
  let consultEpoch = 0
  let ready = Promise.resolve({ session: pl.create(2000) })

  function ensureSession(program) {
    if (program === cachedProgram) {
      return ready
    }

    cachedProgram = program
    const epoch = ++consultEpoch
    const session = pl.create(2000)

    ready = new Promise((resolve) => {
      session.consult(program, {
        success() {
          if (epoch !== consultEpoch) return
          resolve({ session })
        },
        error() {
          if (epoch !== consultEpoch) return
          resolve({ session: pl.create(2000) })
        },
      })
    })

    return ready
  }

  async function getSuggestions({ program, world, query, cursor, maxSuggestions }) {
    const { session } = await ensureSession(program)
    return buildAutocompleteSuggestions({ session, world, query, cursor, maxSuggestions })
  }

  return {
    syncProgram: ensureSession,
    getSuggestions,
  }
}

function buildAutocompleteSuggestions({ session, world, query, cursor, maxSuggestions }) {
  const completion = getCompletionContext(query, cursor)
  const catalog = buildPredicateCatalog(world)
  const prefixAnalysis = analyzePrefix(query, completion.start, catalog)
  const cursorAnalysis = analyzePrefix(query, cursor, catalog)
  const slotKind = inferSlotKind(prefixAnalysis, catalog)
  const call = findCallContext(query, cursor)
  const token = slotKind === 'term' && /^[_A-Z]/.test(completion.token.trim()) ? '' : completion.token

  const pool = [
    ...(slotKind === 'goal'
      ? buildGoalSuggestions({ world, catalog, completion, token })
      : buildTermSuggestions({ world, query, token, call, completion })),
    ...buildContinuationSuggestions({
      query,
      cursor,
      completion,
      slotKind,
      cursorAnalysis,
      catalog,
    }),
  ]

  const deduped = new Map()

  pool
    .map((item) => ({
      ...item,
      score: scoreSuggestion(item, item.queryToken ?? token),
    }))
    .filter((item) => item.score >= 0)
    .forEach((item) => {
      const key = `${item.replaceStart}:${item.replaceEnd}:${item.insert}`
      const existing = deduped.get(key)
      if (!existing || item.score > existing.score) {
        deduped.set(key, item)
      }
    })

  return Array.from(deduped.values())
    .filter((item) => isValidSuggestion(session, query, item, catalog))
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, maxSuggestions)
}

function buildPredicateCatalog(world) {
  const programPredicates = world.predicates.map((predicate) => ({
    id: `program:${predicate.id}`,
    name: predicate.name,
    arity: predicate.arity,
    argKinds: Array.from({ length: predicate.arity }, () => 'term'),
    meta: 'program',
    detail: predicate.sample || 'from program',
    count: predicate.count,
    weight: 74 + predicate.count,
    sample: predicate.sample,
  }))

  const items = [...programPredicates, ...BUILTIN_PREDICATES]
  const byIndicator = new Map(items.map((item) => [`${item.name}/${item.arity}`, item]))
  const byName = new Map()

  items.forEach((item) => {
    const existing = byName.get(item.name)
    if (!existing || item.weight > existing.weight) {
      byName.set(item.name, item)
    }
  })

  return {
    items,
    byIndicator,
    byName,
  }
}

function getCompletionContext(query, cursor) {
  let start = cursor
  let end = cursor

  while (start > 0 && !WORD_DELIMITERS.test(query[start - 1])) {
    start -= 1
  }

  while (end < query.length && !WORD_DELIMITERS.test(query[end])) {
    end += 1
  }

  return {
    start,
    end,
    token: query.slice(start, cursor),
    fullToken: query.slice(start, end),
  }
}

function tokenizeQuery(text) {
  const tokens = []
  let index = 0

  while (index < text.length) {
    const character = text[index]

    if (/\s/.test(character)) {
      index += 1
      continue
    }

    if (character === '\'' || character === '"') {
      const quote = character
      let end = index + 1
      while (end < text.length) {
        if (text[end] === quote && text[end - 1] !== '\\') {
          end += 1
          break
        }
        end += 1
      }
      tokens.push({ type: 'quoted', value: text.slice(index, end), start: index, end })
      index = end
      continue
    }

    if ('(),.;[]{}|'.includes(character)) {
      tokens.push({ type: character, value: character, start: index, end: index + 1 })
      index += 1
      continue
    }

    if (character === '\\' && text[index + 1] === '+') {
      tokens.push({ type: 'operator', value: '\\+', start: index, end: index + 2 })
      index += 2
      continue
    }

    if (/[A-Za-z_]/.test(character)) {
      let end = index + 1
      while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) {
        end += 1
      }
      const value = text.slice(index, end)
      tokens.push({
        type: /^[A-Z_]/.test(value) ? 'variable' : 'atom',
        value,
        start: index,
        end,
      })
      index = end
      continue
    }

    if (/\d/.test(character)) {
      let end = index + 1
      while (end < text.length && /[\d.]/.test(text[end])) {
        end += 1
      }
      tokens.push({ type: 'number', value: text.slice(index, end), start: index, end })
      index = end
      continue
    }

    if (OPERATOR_CHARS.test(character)) {
      let end = index + 1
      while (end < text.length && OPERATOR_CHARS.test(text[end])) {
        end += 1
      }
      tokens.push({ type: 'operator', value: text.slice(index, end), start: index, end })
      index = end
      continue
    }

    tokens.push({ type: 'symbol', value: character, start: index, end: index + 1 })
    index += 1
  }

  return tokens
}

function analyzePrefix(query, cursor, catalog) {
  const tokens = tokenizeQuery(query.slice(0, cursor))
  const root = { type: 'root', kind: 'goal', currentSlotHasContent: false }
  const stack = [root]
  let currentExpectation = 'goal'

  function top() {
    return stack[stack.length - 1]
  }

  function markCurrentSlotHasContent() {
    top().currentSlotHasContent = true
    currentExpectation = 'after_expression'
  }

  function resetCurrentSlot(nextKind) {
    top().currentSlotHasContent = false
    currentExpectation = nextKind
  }

  tokens.forEach((token, index) => {
    const next = tokens[index + 1]

    if (token.type === 'atom') {
      if (WORD_OPERATORS.has(token.value) && top().currentSlotHasContent) {
        resetCurrentSlot('term')
        return
      }

      if (next?.type === '(') {
        return
      }

      markCurrentSlotHasContent()
      return
    }

    if (token.type === 'variable' || token.type === 'number' || token.type === 'quoted') {
      markCurrentSlotHasContent()
      return
    }

    if (token.type === '(') {
      const previous = tokens[index - 1]
      const isCall = previous?.type === 'atom'

      if (isCall) {
        const signature = lookupSignature(catalog, previous.value)
        const call = {
          type: 'call',
          predicate: previous.value,
          argIndex: 0,
          currentSlotHasContent: false,
          knownArity: signature?.arity ?? null,
          argKinds: signature?.argKinds ?? null,
        }
        stack.push(call)
        currentExpectation = getCallArgKind(call, 0)
        return
      }

      const groupKind = currentExpectation === 'term' ? 'term' : 'goal'
      stack.push({ type: 'group', kind: groupKind, currentSlotHasContent: false })
      currentExpectation = groupKind
      return
    }

    if (token.type === '[') {
      stack.push({ type: 'list', currentSlotHasContent: false, afterBar: false })
      currentExpectation = 'term'
      return
    }

    if (token.type === '{') {
      stack.push({ type: 'brace', currentSlotHasContent: false })
      currentExpectation = 'term'
      return
    }

    if (token.type === ')' && (top().type === 'call' || top().type === 'group')) {
      stack.pop()
      markCurrentSlotHasContent()
      return
    }

    if (token.type === ']' && top().type === 'list') {
      stack.pop()
      markCurrentSlotHasContent()
      return
    }

    if (token.type === '}' && top().type === 'brace') {
      stack.pop()
      markCurrentSlotHasContent()
      return
    }

    if (token.type === ',') {
      if (top().type === 'call') {
        top().argIndex += 1
        resetCurrentSlot(getCallArgKind(top(), top().argIndex))
        return
      }

      if (top().type === 'list') {
        top().afterBar = false
        resetCurrentSlot('term')
        return
      }

      resetCurrentSlot(top().type === 'group' && top().kind === 'term' ? 'term' : 'goal')
      return
    }

    if (token.type === ';') {
      resetCurrentSlot('goal')
      return
    }

    if (token.type === '|') {
      if (top().type === 'list') {
        top().afterBar = true
      }
      resetCurrentSlot('term')
      return
    }

    if (token.type === 'operator') {
      if (token.value === '\\+') {
        resetCurrentSlot('goal')
      } else {
        resetCurrentSlot('term')
      }
      return
    }

    if (token.type === '.') {
      resetCurrentSlot('goal')
    }
  })

  return {
    tokens,
    stack,
    currentExpectation,
  }
}

function inferSlotKind(analysis) {
  const top = analysis.stack[analysis.stack.length - 1]

  if (top?.type === 'call') {
    return getCallArgKind(top, top.argIndex)
  }

  if (top?.type === 'list' || top?.type === 'brace') {
    return 'term'
  }

  if (top?.type === 'group') {
    return top.kind
  }

  return analysis.currentExpectation === 'term' ? 'term' : 'goal'
}

function lookupSignature(catalog, name) {
  return catalog.byName.get(name) || null
}

function getCallArgKind(call, index) {
  return call.argKinds?.[index] || 'term'
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

function describePredicateSuggestion(world, predicate) {
  const facts = world.facts.filter(
    (fact) => fact.predicate === predicate.name && fact.arity === predicate.arity,
  )

  if (predicate.arity === 0) {
    return {
      meta: `${predicate.count} clause${predicate.count === 1 ? '' : 's'}`,
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
      preview: predicate.sample || '',
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

function buildGoalSuggestions({ world, catalog, completion, token }) {
  const range = {
    replaceStart: completion.start,
    replaceEnd: completion.end,
  }

  const programSuggestions = world.predicates.map((predicate) => {
    const title = makePredicateGoal(predicate.name, predicate.arity)
    const description = describePredicateSuggestion(world, predicate)

    return {
      id: `goal:${predicate.id}`,
      title,
      insert: title,
      kind: 'goal',
      meta: description.meta,
      preview: description.preview,
      detail: description.detail,
      selection: getFunctorSelection(title, predicate.arity),
      keywords: [predicate.name, predicate.sample, description.meta, description.preview],
      weight: 70 + predicate.count,
      queryToken: token,
      ...range,
    }
  })

  const builtinSuggestions = BUILTIN_PREDICATES.map((predicate) => {
    const title = makePredicateGoal(predicate.name, predicate.arity)

    return {
      id: `goal:${predicate.id}`,
      title,
      insert: title,
      kind: 'builtin',
      meta: predicate.meta,
      preview: '',
      detail: predicate.detail,
      selection: getFunctorSelection(title, predicate.arity),
      keywords: [predicate.name, predicate.meta, predicate.detail],
      weight: predicate.weight,
      queryToken: token,
      ...range,
    }
  })

  const syntaxSuggestions = GOAL_SYNTAX_SUGGESTIONS.map((item) => ({
    ...item,
    preview: '',
    keywords: [item.title, item.meta, item.detail],
    queryToken: token,
    ...range,
  }))

  return [...programSuggestions, ...builtinSuggestions, ...syntaxSuggestions]
}

function getFunctorSelection(title, arity) {
  if (arity <= 0) return null
  const start = title.indexOf('(') + 1
  return [start, start + 1]
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

function buildArgumentValueSuggestions(world, call, token, completion) {
  if (!call) return []

  const matchingFacts = world.facts.filter((fact) => {
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
      weight: 170,
      queryToken: token,
      replaceStart: completion.start,
      replaceEnd: completion.end,
      count: 1,
    })
  })

  return Array.from(byValue.values()).map(({ count, ...item }) => ({
    ...item,
    weight: item.weight + count,
  }))
}

function getVariableSuggestions(query, token, completion) {
  return Array.from(new Set(query.match(/\b[_A-Z][A-Za-z0-9_]*\b/g) || []))
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
      queryToken: token,
      replaceStart: completion.start,
      replaceEnd: completion.end,
    }))
}

function getGenericTermSuggestions(world, token, completion) {
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
      weight: 96,
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
      weight: 94,
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
      weight: 92,
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
      weight: 90,
    },
  ]

  const atoms = Array.from(new Set(world.entityNodes.map((node) => node.label))).map((label) => ({
    id: `atom:${label}`,
    title: formatQueryTerm(label),
    insert: formatQueryTerm(label),
    kind: 'atom',
    meta: 'atom',
    preview: '',
    detail: 'value from program',
    selection: null,
    keywords: [label],
    weight: 74,
  }))

  return [...placeholders, ...atoms].map((item) => ({
    ...item,
    queryToken: token,
    replaceStart: completion.start,
    replaceEnd: completion.end,
  }))
}

function buildTermSuggestions({ world, query, token, call, completion }) {
  return [
    ...buildArgumentValueSuggestions(world, call, token, completion),
    ...getVariableSuggestions(query, token, completion),
    ...getGenericTermSuggestions(world, token, completion),
  ]
}

function buildContinuationSuggestions({ query, cursor, completion, slotKind, cursorAnalysis }) {
  const top = cursorAnalysis.stack[cursorAnalysis.stack.length - 1]
  const atBoundary = cursor === completion.end
  const expressionComplete =
    atBoundary &&
    (cursorAnalysis.currentExpectation === 'after_expression' || isLikelyCompleteToken(completion.fullToken.trim()))
  const nextToken = firstToken(query.slice(cursor))
  const suggestions = []

  function canInsert(trimmedInsert) {
    return !nextToken || nextToken.value !== trimmedInsert
  }

  if (!expressionComplete) {
    if (top?.type === 'list' && !top.currentSlotHasContent && canInsert(']')) {
      suggestions.push(makeContinuationItem('close-list', ']', 'close', 'list', 'close the list', cursor, 60))
    }
    return suggestions
  }

  if (canInsert('=')) {
    suggestions.push({
      ...makeContinuationItem('op:=', '=', 'op', 'unify', 'relate two terms', cursor, 52),
      insert: ' = ',
      followKind: 'term',
    })
  }

  if (canInsert('is')) {
    suggestions.push({
      ...makeContinuationItem('op:is', 'is', 'op', 'arithmetic', 'evaluate the right side', cursor, 48),
      insert: ' is ',
      followKind: 'term',
    })
  }

  if (top?.type === 'call') {
    const remaining = top.knownArity == null ? null : top.knownArity - top.argIndex - 1

    if ((remaining == null || remaining > 0) && canInsert(',')) {
      suggestions.push({
        ...makeContinuationItem(
          `call:comma:${top.predicate}`,
          ',',
          'syntax',
          'next arg',
          'move to the next argument',
          cursor,
          58,
        ),
        insert: ', ',
      })
    }

    if ((remaining == null || remaining <= 0) && canInsert(')')) {
      suggestions.push(makeContinuationItem(`call:close:${top.predicate}`, ')', 'close', 'call', 'close the call', cursor, 64))
    }

    return suggestions
  }

  if (top?.type === 'list') {
    if (canInsert(',')) {
      suggestions.push({
        ...makeContinuationItem('list:comma', ',', 'syntax', 'list', 'add another list item', cursor, 54),
        insert: ', ',
      })
    }

    if (!top.afterBar && canInsert('|')) {
      suggestions.push({
        ...makeContinuationItem('list:bar', '|', 'syntax', 'list tail', 'switch to a tail pattern', cursor, 50),
        insert: ' | ',
      })
    }

    if (canInsert(']')) {
      suggestions.push(makeContinuationItem('list:close', ']', 'close', 'list', 'close the list', cursor, 64))
    }

    return suggestions
  }

  if (top?.type === 'group') {
    if (top.kind === 'goal' && canInsert(',')) {
      suggestions.push({
        ...makeContinuationItem('group:comma', ',', 'syntax', 'and', 'continue with another goal', cursor, 56),
        insert: ', ',
        followKind: 'goal',
      })
    }

    if (top.kind === 'goal' && canInsert(';')) {
      suggestions.push({
        ...makeContinuationItem('group:semicolon', ';', 'syntax', 'or', 'offer an alternative goal', cursor, 54),
        insert: ' ; ',
        followKind: 'goal',
      })
    }

    if (canInsert(')')) {
      suggestions.push(makeContinuationItem('group:close', ')', 'close', 'group', 'close the group', cursor, 66))
    }

    return suggestions
  }

  if (canInsert('.')) {
    suggestions.push(makeContinuationItem('root:dot', '.', 'close', 'query', 'finish the query', cursor, 68))
  }

  if (canInsert(',')) {
    suggestions.push({
      ...makeContinuationItem('root:comma', ',', 'syntax', 'and', 'continue with another goal', cursor, 58),
      insert: ', ',
      followKind: 'goal',
    })
  }

  if (canInsert(';')) {
    suggestions.push({
      ...makeContinuationItem('root:semicolon', ';', 'syntax', 'or', 'offer an alternative goal', cursor, 56),
      insert: ' ; ',
      followKind: 'goal',
    })
  }

  return suggestions
}

function makeContinuationItem(id, title, kind, meta, detail, cursor, weight) {
  return {
    id,
    title,
    insert: title,
    kind,
    meta,
    preview: '',
    detail,
    selection: null,
    keywords: [title, meta, detail],
    weight,
    queryToken: '',
    replaceStart: cursor,
    replaceEnd: cursor,
  }
}

function isLikelyCompleteToken(token) {
  if (!token) return false
  return /^(?:[_A-Z][A-Za-z0-9_]*|[a-z][A-Za-z0-9_]*|-?\d+(?:\.\d+)?|'.*'|".*")$/s.test(token)
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

function applySuggestion(query, item) {
  return `${query.slice(0, item.replaceStart)}${item.insert}${query.slice(item.replaceEnd)}`
}

function isValidSuggestion(session, query, item, catalog) {
  const nextQuery = applySuggestion(query, item)
  const cursor = item.replaceStart + item.insert.length
  const probe = buildParseProbe(nextQuery, cursor, item, catalog)
  return canParseExpression(session, probe)
}

function buildParseProbe(query, cursor, item, catalog) {
  let probe = query

  if (item.followKind && !startsExpression(probe.slice(cursor))) {
    const filler = placeholderForKind(item.followKind)
    probe = `${probe.slice(0, cursor)}${filler}${probe.slice(cursor)}`
    cursor += filler.length
  }

  probe = stripTrailingPeriod(probe)
  probe = finishOpenContainers(probe, catalog)
  return probe
}

function startsExpression(text) {
  const token = firstToken(text)
  if (!token) return false
  if (token.type === 'operator') {
    return token.value === '\\+'
  }
  return ['atom', 'variable', 'number', 'quoted', '(', '[', '{'].includes(token.type)
}

function firstToken(text) {
  return tokenizeQuery(text)[0] || null
}

function placeholderForKind(kind) {
  return kind === 'goal' ? 'true' : 'X'
}

function stripTrailingPeriod(text) {
  const trimmed = text.replace(/\s+$/, '')
  if (!trimmed.endsWith('.')) {
    return trimmed
  }
  return trimmed.slice(0, -1).replace(/\s+$/, '')
}

function finishOpenContainers(query, catalog) {
  const base = query.trim()
  if (!base) return base

  const analysis = analyzePrefix(base, base.length, catalog)
  const containers = analysis.stack.slice(1).map((container) => ({ ...container }))
  let suffix = ''

  while (containers.length) {
    const container = containers.pop()

    if (container.type === 'call') {
      const parts = []
      let provided = container.argIndex + (container.currentSlotHasContent ? 1 : 0)

      if (!container.currentSlotHasContent) {
        parts.push(placeholderForKind(getCallArgKind(container, container.argIndex)))
        provided += 1
      }

      if (container.knownArity != null) {
        for (let index = provided; index < container.knownArity; index += 1) {
          parts.push(placeholderForKind(getCallArgKind(container, index)))
        }
      }

      if (parts.length) {
        suffix += parts.join(', ')
      }
      suffix += ')'
    } else if (container.type === 'group') {
      if (!container.currentSlotHasContent) {
        suffix += placeholderForKind(container.kind)
      }
      suffix += ')'
    } else if (container.type === 'list') {
      if (!container.currentSlotHasContent) {
        suffix += container.afterBar ? 'Tail' : 'X'
      }
      suffix += ']'
    } else if (container.type === 'brace') {
      if (!container.currentSlotHasContent) {
        suffix += 'X'
      }
      suffix += '}'
    }

    if (containers.length) {
      containers[containers.length - 1].currentSlotHasContent = true
    }
  }

  return `${base}${suffix}`
}

function canParseExpression(session, probe) {
  if (!probe.trim()) return false

  try {
    return Boolean(session.parse(probe))
  } catch {
    return false
  }
}
