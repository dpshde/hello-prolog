import { getTauProlog } from './tau-prolog-loader.js'

const pl = getTauProlog()

export const PRESETS = [
  {
    id: 'celestial-lattice',
    name: 'Celestial Lattice',
    blurb: 'Travelers, planets, alliances, and orbital facts arranged like a navigable constellation.',
    query: 'stationed(Who, Where).',
    program: `:- use_module(library(lists)).

traveler(ada).
traveler(orion).
traveler(lyra).

world(mercury).
world(venus).
world(mars).

orbits(mercury, sun).
orbits(venus, sun).
orbits(mars, sun).

ally(ada, orion).
ally(orion, lyra).
ally(lyra, ada).

stationed(ada, mars).
stationed(orion, venus).
stationed(lyra, mercury).

mission(aurora, mars, survey).
mission(vesper, venus, archive).

reachable(X, Y) :- ally(X, Y).
favorite_world(Traveler, World) :- stationed(Traveler, World).`,
  },
  {
    id: 'archive-garden',
    name: 'Archive Garden',
    blurb: 'A quieter starter world of scribes, codices, shelves, and multi-argument dossier facts.',
    query: 'catalogues(Scribe, Codex).',
    program: `scribe(iris).
scribe(nova).
scribe(sol).

codex(ember).
codex(tide).
codex(marrow).

shelf(east).
shelf(north).

catalogues(iris, ember).
catalogues(nova, tide).
catalogues(sol, marrow).

references(ember, tide).
references(tide, marrow).

stored_on(ember, east).
stored_on(tide, north).
stored_on(marrow, east).

dossier(ember, atlas, sealed).
dossier(tide, tidepool, open).`,
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
