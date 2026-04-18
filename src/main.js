import { html, reactive, svg } from '@arrow-js/core'

import './style.css'

import { PRESETS, buildWorld, runQuery } from './prolog.js'
import { createQueryIntellisense } from './query-intellisense.js'

/* ── Constants ── */

const STORAGE_KEY = 'helloprolog:state'
const MAX_HISTORY = 50
const MAX_SUGGESTIONS = 8

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
const queryIntellisense = createQueryIntellisense()
let historyIndex = -1
let historyDraft = ''
let currentFileName = saved?.fileName ?? 'program.pl'
let queryCursor = state.query.length
let autocompleteRequest = 0
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
  queryIntellisense.syncProgram(program)

  const queryInput = getQueryInput()
  if (queryInput && document.activeElement === queryInput) {
    refreshAutocomplete(queryInput, state.autocompleteOpen)
  }
}

syncWorld(state.source)

/* ── Query autocomplete ── */

function getQueryInput() {
  return document.getElementById('query-input')
}

function closeAutocomplete() {
  autocompleteRequest += 1
  state.autocompleteOpen = false
  state.autocompleteIndex = 0
}

async function refreshAutocomplete(input, forceOpen = true) {
  const field = input || getQueryInput()
  const requestId = ++autocompleteRequest
  queryCursor = field?.selectionStart ?? state.query.length

  const nextItems = await queryIntellisense.getSuggestions({
    program: state.source,
    world: state.world,
    query: state.query,
    cursor: queryCursor,
    maxSuggestions: MAX_SUGGESTIONS,
  })

  if (requestId !== autocompleteRequest) {
    return
  }

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
  const replaceStart = item.replaceStart ?? queryCursor
  const replaceEnd = item.replaceEnd ?? replaceStart
  const nextQuery = `${state.query.slice(0, replaceStart)}${item.insert}${state.query.slice(replaceEnd)}`

  state.query = nextQuery
  state.error = ''
  historyIndex = -1
  closeAutocomplete()
  persist()

  const start = replaceStart + (item.selection ? item.selection[0] : item.insert.length)
  const end = replaceStart + (item.selection ? item.selection[1] : item.insert.length)
  queryCursor = start
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
