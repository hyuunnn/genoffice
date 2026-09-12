import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EMBED_NEW_DOC_MARK,
  EMBED_PRINT_MARK,
  PREPARE_TEXT_MARK,
  REQUIRED_RELATIVE,
  StaleSnapshotError,
  assertSnapshotCurrent,
  exposePrepareTextCommand,
  hasCurrentMarks,
  hasEmbedNewDoc,
  hasEmbedPrint,
  hasPrepareTextCommand,
  isPwaPath,
  keepEmbedNewDoc,
  prepareSurfaceComplete,
  staleMarks,
  stripPwaHtml,
} from '../scripts/studio-snapshot.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Real 0.8.6 bundle windows around every needle the patch touches. */
const STOCK = readFileSync(join(HERE, 'fixtures', 'rhwp-0.8.6-agent-excerpt.txt'), 'utf8')

function patchAll(js: string): string {
  return exposePrepareTextCommand(keepEmbedNewDoc(js))
}

/** The injected Document class members must parse as a class body (no commas). */
function classBodyOf(js: string): string {
  const start = js.indexOf(PREPARE_TEXT_MARK)
  const end = js.indexOf('async applyTextCommand', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return js.slice(start, end)
}

describe('studio snapshot helpers', () => {
  it('strips the stock PWA registration from the published index', () => {
    const html = [
      '<link rel="stylesheet" href="/rhwp/assets/index.css">',
      '<link rel="manifest" href="/rhwp/manifest.webmanifest">',
      '<script id="vite-plugin-pwa:register-sw" src="/rhwp/registerSW.js"></script>',
      '<script type="module" src="/rhwp/assets/index.js"></script>',
    ].join('')
    const next = stripPwaHtml(html)
    expect(next).toContain('/rhwp/assets/index.js')
    expect(next).not.toContain('registerSW')
    expect(next).not.toContain('manifest.webmanifest')
  })

  it('rejects service-worker and manifest paths', () => {
    expect(isPwaPath('/rhwp/sw.js')).toBe(true)
    expect(isPwaPath('/rhwp/registerSW.js')).toBe(true)
    expect(isPwaPath('/rhwp/manifest.webmanifest')).toBe(true)
    expect(isPwaPath('/rhwp/assets/index.js')).toBe(false)
  })

  it('requires the studio print surface in the snapshot', () => {
    expect(REQUIRED_RELATIVE).toContain('print.html')
    const html = readFileSync(join(HERE, '..', 'scripts', 'print-surface.html'), 'utf8')
    expect(html).toContain('id="print-loading-message"')
  })

  it('the fixture is pristine upstream code', () => {
    expect(staleMarks(STOCK)).toEqual([])
    expect(hasPrepareTextCommand(STOCK)).toBe(false)
    expect(hasEmbedNewDoc(STOCK)).toBe(false)
  })

  it('keeps file:new-doc and print registered in embed so the host can create and print', () => {
    const next = keepEmbedNewDoc(STOCK)
    expect(hasEmbedNewDoc(next)).toBe(true)
    expect(hasEmbedPrint(next)).toBe(true)
    expect(next).toContain('e.id===`file:new-doc`')
    expect(next).toContain('e.id===`file:print`')
    expect(next).toContain('e.id===`file:print-to-pdf`')
    expect(next).toContain('!sD.includes(e.id)')
    expect(keepEmbedNewDoc(next)).toBe(next)
  })

  it('leaves assets without the command registry untouched', () => {
    expect(keepEmbedNewDoc('export const theme=1')).toBe('export const theme=1')
  })

  it('fails loudly when the embed command filter is no longer in the bundle', () => {
    expect(() => keepEmbedNewDoc('file:new-doc registerAll embed')).toThrow(
      'embed command filter changed',
    )
  })

  it('exposes the document-agent surface next to getSelectionContext', () => {
    const next = exposePrepareTextCommand(STOCK)
    expect(hasPrepareTextCommand(next)).toBe(true)
    expect(prepareSurfaceComplete(next)).toBe(true)
    // class: SHA snapshot helper reused under its minified name
    const snap = STOCK.match(/try\{([A-Za-z_$][\w$]*)\(this\.deps\.wasm,i\)/)?.[1]
    expect(snap).toBeTruthy()
    expect(next).toContain(`${snap}(this.deps.wasm,e.target)`)
    expect(next).toContain('selectionStart')
    // handlers: guarded async wrappers, comma-joined into the handler object literal
    const handlersStart = next.indexOf('async getSelectionContext(){if(await ')
    const handlersEnd = next.indexOf('async applyTextCommand(', handlersStart)
    expect(handlersStart).toBeGreaterThan(-1)
    expect(handlersEnd).toBeGreaterThan(handlersStart)
    const handlers = next.slice(handlersStart, handlersEnd).replace(/,\s*$/, '')
    expect(() => new Function(`return { ${handlers} }`)).not.toThrow()
    // routes: prepareSurfaceComplete already checked every `case` — the chain must still end at applyTextCommand
    expect(next).toContain('case`setColumnDef`:')
    expect(next).toContain('case`applyTextCommand`:')
  })

  it('injects class members without separating commas', () => {
    const body = classBodyOf(exposePrepareTextCommand(STOCK))
    expect(body).not.toMatch(/\},(?:async )?[\w$]+\(/)
    expect(() => new Function(`return class { ${body} }`)).not.toThrow()
  })

  it('encodes WASM format payloads and avoids deferred cell pagination', () => {
    const next = exposePrepareTextCommand(STOCK)
    expect(next).toContain('applyCharFormat(e,t,n,r,JSON.stringify(a))')
    expect(next).toContain('applyParaFormat(e,t,JSON.stringify(r))')
    expect(next).toContain('applyCharFormatInCell(e,t,n,r,i,a,o,JSON.stringify(c))')
    expect(next).toContain('applyParaFormatInCell(e,t,n,r,i,JSON.stringify(p))')
    expect(next).toContain('findOrCreateFontId(String(a.fontName))')
    expect(next).toContain('deleteTextInCell(e,t,n,r,0,0,o)')
    expect(next).toContain('insertTextInCell(e,t,n,r,0,0,x)')
    expect(next).not.toContain('replaceTextInCellDeferredPagination')
    expect(next).toContain('r.splitParagraph(e,')
    expect(next).not.toContain('insertParagraph(e,t+a)')
  })

  it('is idempotent on a complete snapshot', () => {
    const once = patchAll(STOCK)
    expect(patchAll(once)).toBe(once)
    expect(staleMarks(once)).toEqual([])
    expect(() => assertSnapshotCurrent(once)).not.toThrow()
  })

  it('fails loudly when the agent bundle no longer has the snapshot helper', () => {
    const drifted = STOCK.replace(/try\{[A-Za-z_$][\w$]*\(this\.deps\.wasm,i\)/, 'try{snap(i)')
    expect(drifted).toContain('`Document agent is not initialized`')
    expect(() => exposePrepareTextCommand(drifted)).toThrow('paragraph snapshot helper changed')
  })

  it('passes chunks that do not host the document agent through unchanged', () => {
    const chunk = 'export const theme=1;getSelectionContext applyTextCommand'
    expect(exposePrepareTextCommand(chunk)).toBe(chunk)
    expect(hasCurrentMarks(chunk)).toBe(false)
    expect(hasCurrentMarks(patchAll(STOCK))).toBe(true)
  })

  it('fails loudly when only some patch sites match', () => {
    const classOnly = STOCK.replace(/case`getSelectionContext`:return /, 'case`x`:return ')
    expect(() => exposePrepareTextCommand(classOnly)).toThrow('prepareTextCommand surface changed')
  })

  it('reports a snapshot patched by an older script as stale instead of migrating it', () => {
    const legacy = STOCK.replace(
      'selectedTextSha256:',
      '/*genoffice-prepare-text-v4*/selectedTextSha256:',
    )
    expect(staleMarks(legacy)).toEqual(['/*genoffice-prepare-text-v4*/'])
    expect(() => assertSnapshotCurrent(legacy)).toThrow(StaleSnapshotError)
    expect(() => assertSnapshotCurrent(legacy)).toThrow('vendor:studio')

    const pageTurn = `${STOCK}/*genoffice-eager-prefetch*/n()`
    expect(staleMarks(pageTurn)).toEqual(['/*genoffice-eager-prefetch*/'])

    const newDocOnly = STOCK.replace(
      'Ev.filter(e=>!sD.includes(e.id))',
      `Ev.filter(e=>${EMBED_NEW_DOC_MARK}e.id===\`file:new-doc\`||!sD.includes(e.id))`,
    )
    expect(newDocOnly).not.toContain(EMBED_PRINT_MARK)
    expect(() => keepEmbedNewDoc(newDocOnly)).toThrow(StaleSnapshotError)

    const truncated = patchAll(STOCK).replace('case`setColumnDef`:', 'case`gone`:')
    expect(() => exposePrepareTextCommand(truncated)).toThrow(StaleSnapshotError)
  })
})
