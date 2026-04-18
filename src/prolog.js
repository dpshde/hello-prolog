import { getTauProlog } from './tau-prolog-loader.js'

const pl = getTauProlog()

export const PRESETS = [
  {
    id: 'abraham-family',
    name: 'Abraham Family',
    blurb: 'Patriarchs, journeys, covenant moments, and household relationships from Genesis.',
    query: 'travels(Person, From, To).',
    program: `:- use_module(library(lists)).

patriarch(abraham).
matriarch(sarah).
son(isaac).
servant(hagar).
kinsman(lot).

place(ur).
place(haran).
place(canaan).
place(gerar).
place(moriah).
place(wilderness).

spouse(abraham, sarah).
parent(abraham, isaac).
parent(sarah, isaac).
kinsman_of(abraham, lot).

travels(abraham, ur, haran).
travels(abraham, haran, canaan).
travels(abraham, gerar, moriah).

covenant(abraham, circumcision, canaan).
encounter(hagar, angel_of_yhwh, wilderness).
test(abraham, isaac, moriah).
burial(sarah, hebron, machpelah).

descendant(X, Y) :- parent(X, Y).
heir(Child) :- parent(abraham, Child).`,
  },
  {
    id: 'pauline-letters',
    name: 'Pauline Letters',
    blurb: 'Paul, his companions, churches, cities, letters, and themes across the New Testament.',
    query: 'sent_to(Letter, City).',
    program: `apostle(paul).
companion(timothy).
companion(silas).
coworker(priscilla).
coworker(aquila).

city(rome).
city(corinth).
city(ephesus).
city(philippi).
city(thessalonica).

letter(romans).
letter(corinthians_1).
letter(ephesians).
letter(philippians).
letter(thessalonians_1).

writes(paul, romans).
writes(paul, corinthians_1).
writes(paul, ephesians).
writes(paul, philippians).
writes(paul, thessalonians_1).

sent_to(romans, rome).
sent_to(corinthians_1, corinth).
sent_to(ephesians, ephesus).
sent_to(philippians, philippi).
sent_to(thessalonians_1, thessalonica).

travels_with(paul, timothy).
travels_with(paul, silas).
married(priscilla, aquila).
hosts(priscilla, ephesus).
hosts(aquila, ephesus).

theme(romans, justification).
theme(corinthians_1, resurrection).
theme(ephesians, unity).
theme(philippians, joy).
theme(thessalonians_1, hope).

mission(paul, corinth, encouraging_church).
mission(paul, ephesus, teaching_daily).
mission(paul, philippi, strengthening_believers).`,
  },
]

function stripLineComments(program) {
  return program
    .split('\n')
    .map((line) => line.replace(/%.*$/, ''))
    .join('\n')
}

function splitTopLevel(text, separator = ',') {
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

    if (character === separator && depth === 0) {
      const value = buffer.trim()
      if (value) {
        parts.push(value)
      }
      buffer = ''
      continue
    }

    buffer += character
  }

  const tail = buffer.trim()
  if (tail) {
    parts.push(tail)
  }

  return parts
}

function splitStatements(program) {
  const statements = []
  let buffer = ''
  let depth = 0
  let quote = null

  const source = stripLineComments(program)

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (quote) {
      buffer += character
      if (character === quote && source[index - 1] !== '\\') {
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

    if (character === '.' && depth === 0) {
      const statement = buffer.trim()
      if (statement) {
        statements.push(statement)
      }
      buffer = ''
      continue
    }

    buffer += character
  }

  const trailing = buffer.trim()
  if (trailing) {
    statements.push(trailing)
  }

  return statements
}

function normalizeTerm(rawTerm) {
  const trimmed = rawTerm.trim()
  if (!trimmed) {
    return '?'
  }

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function parseFact(statement, index) {
  const trimmed = statement.trim()
  if (!trimmed || trimmed.startsWith(':-') || trimmed.includes(':-')) {
    return null
  }

  const match = trimmed.match(/^([a-z][\w]*)\s*(?:\((.*)\))?$/i)
  if (!match) {
    return null
  }

  const [, predicate, rawArgs = ''] = match
  const args = rawArgs ? splitTopLevel(rawArgs).map(normalizeTerm) : []

  return {
    id: `fact-${index}`,
    predicate,
    args,
    arity: args.length,
    statement: `${trimmed}.`,
  }
}

function layoutRing(nodes, radius, centerX, centerY, angleOffset) {
  if (!nodes.length) {
    return nodes
  }

  const step = (Math.PI * 2) / nodes.length

  return nodes.map((node, index) => {
    const angle = angleOffset + step * index

    return {
      ...node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    }
  })
}

export function makePredicateQuery(predicate, arity) {
  if (arity <= 0) {
    return `${predicate}.`
  }

  const variableNames = ['A', 'B', 'C', 'D', 'E', 'F']
  const args = Array.from({ length: arity }, (_, index) => variableNames[index] || `X${index + 1}`)
  return `${predicate}(${args.join(', ')}).`
}

export function buildWorld(program) {
  const facts = splitStatements(program)
    .map((statement, index) => parseFact(statement, index))
    .filter(Boolean)

  const entityMap = new Map()
  const relationNodes = []
  const edges = []
  const predicateMap = new Map()

  function ensureEntity(term) {
    const id = `entity:${term}`
    const existing = entityMap.get(id)
    if (existing) {
      return existing
    }

    const next = {
      id,
      label: term,
      kind: 'entity',
      tags: [],
    }

    entityMap.set(id, next)
    return next
  }

  facts.forEach((fact, index) => {
    const summary = predicateMap.get(fact.predicate) || {
      id: fact.predicate,
      name: fact.predicate,
      count: 0,
      arity: fact.arity,
      sample: fact.statement,
      query: makePredicateQuery(fact.predicate, fact.arity),
    }

    summary.count += 1
    summary.arity = Math.max(summary.arity, fact.arity)
    predicateMap.set(fact.predicate, summary)

    if (fact.arity === 1) {
      const entity = ensureEntity(fact.args[0])
      if (!entity.tags.includes(fact.predicate)) {
        entity.tags.push(fact.predicate)
      }
      return
    }

    if (fact.arity === 2) {
      const source = ensureEntity(fact.args[0])
      const target = ensureEntity(fact.args[1])
      edges.push({
        id: `edge-${index}`,
        source: source.id,
        target: target.id,
        label: fact.predicate,
        kind: 'binary',
      })
      return
    }

    const relationNode = {
      id: `relation:${fact.id}`,
      label: `${fact.predicate}/${fact.arity}`,
      detail: fact.statement,
      kind: 'relation',
    }

    relationNodes.push(relationNode)

    fact.args.forEach((term, position) => {
      const entity = ensureEntity(term)
      edges.push({
        id: `edge-${index}-${position}`,
        source: relationNode.id,
        target: entity.id,
        label: `${position + 1}`,
        kind: 'compound',
      })
    })
  })

  const entityNodes = layoutRing(
    Array.from(entityMap.values()).sort((left, right) => left.label.localeCompare(right.label)),
    282,
    390,
    320,
    -Math.PI / 2,
  )

  const innerNodes = layoutRing(
    relationNodes,
    Math.max(112, relationNodes.length * 22),
    390,
    320,
    Math.PI / 2,
  )

  const nodes = [...entityNodes, ...innerNodes]
  const nodeLookup = Object.fromEntries(nodes.map((node) => [node.id, node]))
  const predicates = Array.from(predicateMap.values()).sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name),
  )

  return {
    facts,
    nodes,
    nodeLookup,
    entityNodes,
    relationNodes: innerNodes,
    edges,
    predicates,
    stats: {
      factCount: facts.length,
      entityCount: entityNodes.length,
      predicateCount: predicates.length,
    },
  }
}

function normalizeGoal(query) {
  const trimmed = query.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`
}

function formatAnswer(answer) {
  return pl
    .format_answer(answer)
    .replace(/\s+/g, ' ')
    .replace(/\s*[.;]\s*$/, '')
    .trim()
}

function toMessage(error, fallback) {
  if (!error) {
    return fallback
  }

  if (typeof error === 'string') {
    return error
  }

  if (typeof error.toString === 'function') {
    return error.toString()
  }

  return fallback
}

export async function runQuery(program, query) {
  const goal = normalizeGoal(query)
  if (!goal) {
    throw new Error('Write a goal before running the REPL.')
  }

  const session = pl.create(5000)
  const answers = []

  await new Promise((resolve, reject) => {
    session.consult(program, {
      success() {
        session.query(goal, {
          success() {
            const pullAnswer = () => {
              session.answer({
                success(answer) {
                  answers.push(formatAnswer(answer) || 'true')
                  pullAnswer()
                },
                fail() {
                  resolve()
                },
                limit() {
                  reject(new Error('The search exceeded Tau Prolog’s answer limit.'))
                },
                error(error) {
                  reject(new Error(toMessage(error, 'Tau Prolog raised an execution error.')))
                },
              })
            }

            pullAnswer()
          },
          error(error) {
            reject(new Error(toMessage(error, 'Tau Prolog could not parse that goal.')))
          },
        })
      },
      error(error) {
        reject(new Error(toMessage(error, 'Tau Prolog could not parse the program.')))
      },
    })
  })

  return answers
}
