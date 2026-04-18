import coreSource from 'tau-prolog/modules/core.js?raw'
import listsSource from 'tau-prolog/modules/lists.js?raw'

let cachedPl

function runClassicScript(source) {
  const runner = new Function(source)
  runner()
}

export function getTauProlog() {
  if (cachedPl) {
    return cachedPl
  }

  if (typeof window === 'undefined') {
    throw new Error('Tau Prolog requires a browser environment in this starter.')
  }

  if (!window.pl) {
    runClassicScript(coreSource)
  }

  if (!window.__helloPrologTauListsLoaded) {
    runClassicScript(`var pl = window.pl;\n${listsSource}`)
    window.__helloPrologTauListsLoaded = true
  }

  cachedPl = window.pl
  return cachedPl
}
