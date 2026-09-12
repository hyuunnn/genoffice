/**
 * Shared rhwp-studio snapshot helpers for the vendor script and tests.
 *
 * Every patch here is written against the pristine 0.8.6 pages bundle. A
 * snapshot is either pristine (no `genoffice-*` marks), current (all marks
 * present and complete), or stale (marks from an older version of this
 * script). Stale snapshots are never migrated in place — `--ensure` reports
 * `StaleSnapshotError` and the fix is `npm run vendor:studio -w @genoffice/hwp`.
 */

export const PWA_FILES = ['sw.js', 'registerSW.js', 'manifest.webmanifest']

export const REQUIRED_RELATIVE = [
  'index.html',
  'print.html',
  'fonts/NotoSansKR-Regular.woff2',
  'fonts/Pretendard-Regular.woff2',
]

export const REQUIRED_ASSET_EXTS = ['.js', '.wasm']

const PWA_HTML_RE =
  /<link\s+rel="manifest"[^>]*>|<script[^>]*(?:id="vite-plugin-pwa:register-sw"|src="[^"]*registerSW\.js")[^>]*><\/script>/g

export function isPwaPath(urlPath) {
  const name = urlPath.split('?')[0].split('/').pop() ?? ''
  return PWA_FILES.includes(name) || /^workbox-.*\.js$/.test(name)
}

export function stripPwaHtml(html) {
  return html.replace(PWA_HTML_RE, '')
}

/** Thrown when a local snapshot carries marks this script no longer produces. */
export class StaleSnapshotError extends Error {
  constructor(detail) {
    super(
      `rhwp-studio snapshot is stale (${detail}) — run \`npm run vendor:studio -w @genoffice/hwp\``,
    )
    this.name = 'StaleSnapshotError'
  }
}

/**
 * Embed mode strips File new/open/save/print from the registry so the host owns
 * those actions — and also skips boot-time `createNewDocument()`. Untitled tabs
 * then have no pages. Keep `file:new-doc` plus print/PDF; pruneEmbedChrome()
 * still hides the studio File menu items.
 */
export const EMBED_NEW_DOC_MARK = '/*genoffice-embed-new-doc*/'
export const EMBED_PRINT_MARK = '/*genoffice-embed-print*/'

const EMBED_NEW_DOC_RE =
  /bA\.registerAll\(yA===`embed`\?Ev\.filter\(e=>!sD\.includes\(e\.id\)\):Ev\)/

const EMBED_KEEP_IDS =
  'e.id===`file:new-doc`||e.id===`file:print`||e.id===`file:print-to-pdf`||!sD.includes(e.id)'

export function keepEmbedNewDoc(js) {
  if (js.includes(EMBED_PRINT_MARK)) return js
  if (js.includes(EMBED_NEW_DOC_MARK)) throw new StaleSnapshotError('embed filter lacks print')
  if (!js.includes('file:new-doc') || !js.includes('registerAll')) return js
  const next = js.replace(
    EMBED_NEW_DOC_RE,
    `bA.registerAll(yA===\`embed\`?Ev.filter(e=>${EMBED_NEW_DOC_MARK}${EMBED_PRINT_MARK}${EMBED_KEEP_IDS}):Ev)`,
  )
  if (next === js) {
    throw new Error('rhwp-studio embed command filter changed — update keepEmbedNewDoc()')
  }
  return next
}

export function hasEmbedNewDoc(js) {
  return js.includes(EMBED_NEW_DOC_MARK)
}

export function hasEmbedPrint(js) {
  return js.includes(EMBED_PRINT_MARK)
}

/**
 * Studio computes paragraph SHA fences inside getSelectionContext but throws
 * them away. The public SDK cannot add fields there (exactKeys), so expose a
 * sibling prepareTextCommand for the host to bind applyTextCommand.
 */
export const PREPARE_TEXT_MARK = '/*genoffice-prepare-text-v7*/'

/** Marks the current script emits. Any other `genoffice-*` mark means a stale snapshot. */
const CURRENT_MARKS = new Set([PREPARE_TEXT_MARK, EMBED_NEW_DOC_MARK, EMBED_PRINT_MARK])
const GENOFFICE_MARK_RE = /\/\*genoffice-[a-z0-9-]+\*\//g

export function staleMarks(js) {
  const seen = new Set()
  for (const match of js.matchAll(GENOFFICE_MARK_RE)) {
    if (!CURRENT_MARKS.has(match[0])) seen.add(match[0])
  }
  return [...seen]
}

export function assertSnapshotCurrent(js) {
  const stale = staleMarks(js)
  if (stale.length) throw new StaleSnapshotError(`legacy marks ${stale.join(', ')}`)
}

const PREPARE_SNAP_RE = /try\{([A-Za-z_$][\w$]*)\(this\.deps\.wasm,i\),this\.currentFormat\(\)/
const PREPARE_CLASS_RE =
  /selectedTextSha256:([A-Za-z_$][\w$]*)\}\}async applyTextCommand\(([A-Za-z_$][\w$]*)\)\{/
const PREPARE_HANDLER_RE =
  /async getSelectionContext\(\)\{if\(await ([A-Za-z_$][\w$]*),!([A-Za-z_$][\w$]*)\)throw Error\(`Document agent is not initialized`\);return \2\.getSelectionContext\(\)\},async applyTextCommand\(/
const PREPARE_ROUTE_RE =
  /case`getSelectionContext`:return ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),`getSelectionContext params`\),([A-Za-z_$][\w$]*)\.getSelectionContext\(\);case`applyTextCommand`:/

/** Per-paragraph table-control scan cap. Controls past this index are skipped. */
const TABLE_CONTROLS_PER_PARA = 8

// Document class methods. These are class members: NO commas between them.
// A comma here is a SyntaxError — blank Hangul page, Enter does nothing.

function insertBodyMethod() {
  // WasmBridge has splitParagraph (Enter) but not insertParagraph.
  // Split the predecessor at its end so a locked first paragraph is not cloned as N locked rows.
  return `insertBodyParagraphs(e,t,n){this.syncGeneration();let r=this.deps.wasm,i=Number(n);if(!Number.isInteger(e)||!Number.isInteger(t)||!Number.isInteger(i)||i<1)throw Error(\`insert count must be a positive integer\`);let s=r.getParagraphCount(e);if(!s)throw Error(\`문서가 로드되지 않았습니다\`);if(t<1){for(let a=0;a<i;a+=1){let o=r.splitParagraph(e,0,0);if(typeof o==\`string\`)try{o=JSON.parse(o)}catch{}if(o&&o.ok===!1)throw Error(String(o.error||o.message||\`splitParagraph failed\`))}}else{let p=Math.min(Math.max(t,1),s)-1,l=r.getParagraphLength(e,p);for(let a=0;a<i;a+=1){let o=r.splitParagraph(e,p,l);if(typeof o==\`string\`)try{o=JSON.parse(o)}catch{}if(o&&o.ok===!1)throw Error(String(o.error||o.message||\`splitParagraph failed\`))}}return{section:e,index:t,count:i}}`
}

function insertFilledMethod() {
  // One RPC: insert empties, then applyTextCommand each line (re-list before every apply).
  return `async insertFilledParagraphs(e,t,n){if(!Array.isArray(n)||n.length<1)throw Error(\`insert texts must be a non-empty array\`);this.insertBodyParagraphs(e,t,n.length);let r=0,i=t,s=0;while(r<n.length){this.syncGeneration();let a=this.listBodyParagraphs(),o=null;for(let c=0;c<a.length;c+=1){let l=a[c];if(l&&l.editable&&l.target&&l.target.section===e&&l.target.paragraph>=i){o=l;break}}if(!o){s+=1;if(s>n.length+4)throw Error(\`paragraph is not editable\`);let u=a[a.length-1];this.insertBodyParagraphs(u&&u.target?u.target.section:e,u&&u.target?u.target.paragraph+1:t,n.length-r);continue}let d=this.getDocumentState();await this.applyTextCommand({schemaVersion:1,commandId:crypto.randomUUID(),expectedDocumentEpoch:d.documentEpoch,expectedChangeSeq:d.changeSeq,expectedDocumentSha256:d.documentSha256,target:o.target,expectedBeforeSha256:o.textSha256,expectedFormatSha256:o.formatSha256,expectedAdjacentContextSha256:o.adjacentContextSha256,replacement:String(n[r]??\`\`)});r+=1;i=o.target.paragraph+1;s=0}return{section:e,index:t,count:n.length}}`
}

function charFormatMethod() {
  return `applyBodyCharFormat(e,t,n,r,i){this.syncGeneration();let a=i&&typeof i==\`object\`?Object.assign({},i):{};if(a.fontName){let o=this.deps.wasm.findOrCreateFontId(String(a.fontName));if(!(o>=0))throw Error(\`font not found\`);a.fontId=o;delete a.fontName}let s=this.deps.wasm.applyCharFormat(e,t,n,r,JSON.stringify(a));if(typeof s==\`string\`)try{s=JSON.parse(s)}catch{}if(s&&s.ok===!1)throw Error(String(s.error||s.message||\`applyCharFormat failed\`));return s}`
}

function cellFormatMethods() {
  return `applyCellCharFormat(e,t,n,r,i,a,o,s){this.syncGeneration();let c=s&&typeof s==\`object\`?Object.assign({},s):{};if(c.fontName){let f=this.deps.wasm.findOrCreateFontId(String(c.fontName));if(!(f>=0))throw Error(\`font not found\`);c.fontId=f;delete c.fontName}let x=this.deps.wasm.applyCharFormatInCell(e,t,n,r,i,a,o,JSON.stringify(c));if(typeof x==\`string\`)try{x=JSON.parse(x)}catch{}if(x&&x.ok===!1)throw Error(String(x.error||x.message||\`applyCharFormatInCell failed\`));return x}applyCellParaFormat(e,t,n,r,i,a){this.syncGeneration();let p=a&&typeof a==\`object\`?Object.assign({},a):{};let x=this.deps.wasm.applyParaFormatInCell(e,t,n,r,i,JSON.stringify(p));if(typeof x==\`string\`)try{x=JSON.parse(x)}catch{}if(x&&x.ok===!1)throw Error(String(x.error||x.message||\`applyParaFormatInCell failed\`));return x}`
}

function unwrapWasm(assign, fail) {
  return `if(typeof ${assign}==\`string\`)try{${assign}=JSON.parse(${assign})}catch{}if(${assign}&&${assign}.ok===!1)throw Error(String(${assign}.error||${assign}.message||\`${fail}\`));return ${assign}`
}

function tableEditMethods() {
  return `insertTableRow(e,t,n,r,i){this.syncGeneration();let x=this.deps.wasm.insertTableRow(e,t,n,r,i===!0||i===1);${unwrapWasm('x', 'insertTableRow failed')}}insertTableColumn(e,t,n,r,i){this.syncGeneration();let x=this.deps.wasm.insertTableColumn(e,t,n,r,i===!0||i===1);${unwrapWasm('x', 'insertTableColumn failed')}}deleteTableRow(e,t,n,r){this.syncGeneration();let x=this.deps.wasm.deleteTableRow(e,t,n,r);${unwrapWasm('x', 'deleteTableRow failed')}}deleteTableColumn(e,t,n,r){this.syncGeneration();let x=this.deps.wasm.deleteTableColumn(e,t,n,r);${unwrapWasm('x', 'deleteTableColumn failed')}}mergeTableCells(e,t,n,r,i,a,o){this.syncGeneration();let x=this.deps.wasm.mergeTableCells(e,t,n,r,i,a,o);${unwrapWasm('x', 'mergeTableCells failed')}}splitTableCellInto(e,t,n,r,i,a,o,s,c){this.syncGeneration();let x=this.deps.wasm.splitTableCellInto(e,t,n,r,i,a,o,s,c);${unwrapWasm('x', 'splitTableCellInto failed')}}setCellProperties(e,t,n,r,i){this.syncGeneration();let x=this.deps.wasm.setCellProperties(e,t,n,r,i);${unwrapWasm('x', 'setCellProperties failed')}}setTableProperties(e,t,n,r){this.syncGeneration();let x=this.deps.wasm.setTableProperties(e,t,n,r);${unwrapWasm('x', 'setTableProperties failed')}}getTableProperties(e,t,n){this.syncGeneration();let x=this.deps.wasm.getTableProperties(e,t,n);${unwrapWasm('x', 'getTableProperties failed')}}getPageDef(e){this.syncGeneration();let x=this.deps.wasm.getPageDef(e);${unwrapWasm('x', 'getPageDef failed')}}setPageDef(e,t){this.syncGeneration();let x=this.deps.wasm.setPageDef(e,t);${unwrapWasm('x', 'setPageDef failed')}}getColumnDef(e){this.syncGeneration();let x=this.deps.wasm.getColumnDef(e);${unwrapWasm('x', 'getColumnDef failed')}}setColumnDef(e,t,n,r,i){this.syncGeneration();let x=this.deps.wasm.setColumnDef(e,t,n,r,i);${unwrapWasm('x', 'setColumnDef failed')}}`
}

function formatAgentMethods() {
  // Dialog-free table + char/para format. Wasm bridge already wraps createTable / apply*.
  return `insertTable(e,t,n,r){this.syncGeneration();let i=Number(n),s=Number(r);if(!Number.isInteger(e)||!Number.isInteger(t)||!Number.isInteger(i)||!Number.isInteger(s)||i<1||s<1)throw Error(\`table size must be positive integers\`);if(i>20||s>10)throw Error(\`table is too large\`);let a=this.deps.wasm.createTable(e,t,0,i,s);if(typeof a==\`string\`)try{a=JSON.parse(a)}catch{}if(a&&a.ok===!1)throw Error(String(a.error||a.message||\`createTable failed\`));return{section:e,paragraph:Number(a?.paraIdx??t),control:Number(a?.controlIdx??0),rows:i,cols:s}}${charFormatMethod()}applyBodyParaFormat(e,t,n){this.syncGeneration();let r=n&&typeof n==\`object\`?Object.assign({},n):{};if(r.headType===\`Bullet\`){r.numberingId=this.deps.wasm.ensureDefaultBullet(r.bulletChar||\`●\`);r.paraLevel=0;delete r.bulletChar}else if(r.headType===\`Number\`){r.numberingId=this.deps.wasm.ensureDefaultNumbering();r.paraLevel=0}let i=this.deps.wasm.applyParaFormat(e,t,JSON.stringify(r));if(typeof i==\`string\`)try{i=JSON.parse(i)}catch{}if(i&&i.ok===!1)throw Error(String(i.error||i.message||\`applyParaFormat failed\`));return i}${cellFormatMethods()}${tableEditMethods()}`
}

function replaceCellMethod() {
  // Deferred cell replace patches the page tree; a burst of fills traps WASM.
  return `replaceCell(e,t,n,r,i){this.syncGeneration();let a=this.deps.wasm,o=Number(a.getCellParagraphLength(e,t,n,r,0))||0;if(o>0){let d=a.deleteTextInCell(e,t,n,r,0,0,o);if(typeof d==\`string\`)try{d=JSON.parse(d)}catch{}if(d&&d.ok===!1)throw Error(String(d.error||d.message||\`deleteTextInCell failed\`))}let x=String(i??\`\`);if(!x)return{ok:!0};let s=a.insertTextInCell(e,t,n,r,0,0,x);if(typeof s==\`string\`)try{s=JSON.parse(s)}catch{}if(s&&s.ok===!1)throw Error(String(s.error||s.message||\`insertTextInCell failed\`));return s}`
}

function tableAgentMethods() {
  return `listTables(){this.syncGeneration();let e=this.deps.wasm,t=[];for(let n=0;n<e.getSectionCount();n+=1)for(let r=0;r<e.getParagraphCount(n);r+=1)for(let i=0;i<${TABLE_CONTROLS_PER_PARA};i+=1){let a;try{a=e.getTableDimensions(n,r,i);if(typeof a==\`string\`)a=JSON.parse(a)}catch{continue}if(!a||!a.rowCount)continue;let o=[],s=Number(a.cellCount||0);for(let c=0;c<s;c+=1){try{let l=e.getCellInfo(n,r,i,c);if(typeof l==\`string\`)l=JSON.parse(l);let u=e.getCellParagraphCount(n,r,i,c),d=[];for(let f=0;f<u;f+=1){let p=e.getCellParagraphLength(n,r,i,c,f);d.push(p>0?e.getTextInCell(n,r,i,c,f,0,p):\`\`)}o.push({index:c,row:l.row,col:l.col,text:d.join(\`\\n\`)})}catch{}}t.push({section:n,paragraph:r,control:i,rows:a.rowCount,cols:a.colCount,cells:o})}return t}${replaceCellMethod()}${insertBodyMethod()}${insertFilledMethod()}${formatAgentMethods()}`
}

function prepareAgentMethods(snap) {
  return `${PREPARE_TEXT_MARK}prepareTextCommand(){let e=this.getSelectionContext(),n=this.deps.input.getSelection(),r=null,i=null;if(e.target&&n&&n.start&&n.end&&n.start.sectionIndex===e.target.section&&n.start.paragraphIndex===e.target.paragraph&&n.end.sectionIndex===e.target.section&&n.end.paragraphIndex===e.target.paragraph&&n.end.charOffset>n.start.charOffset){r=n.start.charOffset,i=n.end.charOffset}if(!e.editable||!e.target)return{editable:!1,reason:\`not_editable\`,target:e.target,text:null,textSha256:null,formatSha256:null,adjacentContextSha256:null,selectionStart:r,selectionEnd:i};try{let t=${snap}(this.deps.wasm,e.target);return{editable:!0,reason:null,target:e.target,text:t.text,textSha256:t.textSha256,formatSha256:t.formatSha256,adjacentContextSha256:t.adjacentContextSha256,selectionStart:r,selectionEnd:i}}catch(a){return{editable:!1,reason:String(a&&a.message||a),target:e.target,text:null,textSha256:null,formatSha256:null,adjacentContextSha256:null,selectionStart:r,selectionEnd:i}}}listBodyParagraphs(){this.syncGeneration();let e=this.deps.wasm,t=[];for(let n=0;n<e.getSectionCount();n+=1)for(let r=0;r<e.getParagraphCount(n);r+=1){let i=e.getParagraphLength(n,r),a={kind:\`body_paragraph\`,section:n,paragraph:r,charOffset:0,length:i};try{let o=${snap}(e,a);t.push({editable:!0,reason:null,target:a,text:o.text,textSha256:o.textSha256,formatSha256:o.formatSha256,adjacentContextSha256:o.adjacentContextSha256})}catch(s){t.push({editable:!1,reason:String(s&&s.message||s),target:a,text:null,textSha256:null,formatSha256:null,adjacentContextSha256:null})}}return t}listFields(){this.syncGeneration();let e=this.deps.wasm.getFieldList();if(typeof e==\`string\`)try{e=JSON.parse(e)}catch{e=[]}if(!Array.isArray(e))return[];return e.map(t=>{let n=t&&(t.name||t.fieldName||t.fieldId||t.id)||\`\`,r=\`\`;if(n)try{let i=this.deps.wasm.getFieldValueByName(n);r=typeof i==\`string\`?i:i==null?\`\`:String(i)}catch{}return{name:n,value:r,type:t&&t.fieldType||null}}).filter(t=>t.name)}setField(e,t){this.syncGeneration();return this.deps.wasm.setFieldValueByName(String(e??\`\`),String(t??\`\`))}${tableAgentMethods()}`
}

// Document-agent handler object literal (commas required) and RPC switch cases.

function guarded(ready, agent, name, params) {
  return `async ${name}(${params}){if(await ${ready},!${agent})throw Error(\`Document agent is not initialized\`);return ${agent}.${name}(${params})}`
}

const HANDLER_SIGNATURES = [
  ['getSelectionContext', ''],
  ['prepareTextCommand', ''],
  ['listBodyParagraphs', ''],
  ['listFields', ''],
  ['setField', 'e,t'],
  ['listTables', ''],
  ['replaceCell', 'e,t,n,r,i'],
  ['insertBodyParagraphs', 'e,t,n'],
  ['insertFilledParagraphs', 'e,t,n'],
  ['insertTable', 'e,t,n,r'],
  ['applyBodyCharFormat', 'e,t,n,r,i'],
  ['applyBodyParaFormat', 'e,t,n'],
  ['applyCellCharFormat', 'e,t,n,r,i,a,o,s'],
  ['applyCellParaFormat', 'e,t,n,r,i,a'],
  ['insertTableRow', 'e,t,n,r,i'],
  ['insertTableColumn', 'e,t,n,r,i'],
  ['deleteTableRow', 'e,t,n,r'],
  ['deleteTableColumn', 'e,t,n,r'],
  ['mergeTableCells', 'e,t,n,r,i,a,o'],
  ['splitTableCellInto', 'e,t,n,r,i,a,o,s,c'],
  ['setCellProperties', 'e,t,n,r,i'],
  ['setTableProperties', 'e,t,n,r'],
  ['getTableProperties', 'e,t,n'],
  ['getPageDef', 'e'],
  ['setPageDef', 'e,t'],
  ['getColumnDef', 'e'],
  ['setColumnDef', 'e,t,n,r,i'],
]

function prepareAgentHandlers(ready, agent) {
  const handlers = HANDLER_SIGNATURES.map(([name, params]) => guarded(ready, agent, name, params))
  return `${handlers.join(',')},async applyTextCommand(`
}

function tableEditRoutes(host, params) {
  return `case\`insertTableRow\`:return ${host}.insertTableRow(${params}.section,${params}.paragraph,${params}.control,${params}.row,${params}.after);case\`insertTableColumn\`:return ${host}.insertTableColumn(${params}.section,${params}.paragraph,${params}.control,${params}.col,${params}.after);case\`deleteTableRow\`:return ${host}.deleteTableRow(${params}.section,${params}.paragraph,${params}.control,${params}.row);case\`deleteTableColumn\`:return ${host}.deleteTableColumn(${params}.section,${params}.paragraph,${params}.control,${params}.col);case\`mergeTableCells\`:return ${host}.mergeTableCells(${params}.section,${params}.paragraph,${params}.control,${params}.startRow,${params}.startCol,${params}.endRow,${params}.endCol);case\`splitTableCellInto\`:return ${host}.splitTableCellInto(${params}.section,${params}.paragraph,${params}.control,${params}.row,${params}.col,${params}.rows,${params}.cols,${params}.equalHeight,${params}.mergeFirst);case\`setCellProperties\`:return ${host}.setCellProperties(${params}.section,${params}.paragraph,${params}.control,${params}.cellIndex,${params}.props);case\`setTableProperties\`:return ${host}.setTableProperties(${params}.section,${params}.paragraph,${params}.control,${params}.props);case\`getTableProperties\`:return ${host}.getTableProperties(${params}.section,${params}.paragraph,${params}.control);case\`getPageDef\`:return ${host}.getPageDef(${params}.section);case\`setPageDef\`:return ${host}.setPageDef(${params}.section,${params}.props);case\`getColumnDef\`:return ${host}.getColumnDef(${params}.section);case\`setColumnDef\`:return ${host}.setColumnDef(${params}.section,${params}.count,${params}.columnType,${params}.sameWidth,${params}.spacing);`
}

function prepareAgentRoutes(guard, params, host) {
  return `case\`getSelectionContext\`:return ${guard}(${params},\`getSelectionContext params\`),${host}.getSelectionContext();case\`prepareTextCommand\`:return ${host}.prepareTextCommand();case\`listBodyParagraphs\`:return ${host}.listBodyParagraphs();case\`listFields\`:return ${host}.listFields();case\`setField\`:return ${host}.setField(${params}.name,${params}.value);case\`listTables\`:return ${host}.listTables();case\`replaceCell\`:return ${host}.replaceCell(${params}.section,${params}.paragraph,${params}.control,${params}.cellIndex,${params}.text);case\`insertBodyParagraphs\`:return ${host}.insertBodyParagraphs(${params}.section,${params}.index,${params}.count);case\`insertFilledParagraphs\`:return ${host}.insertFilledParagraphs(${params}.section,${params}.index,${params}.texts);case\`insertTable\`:return ${host}.insertTable(${params}.section,${params}.index,${params}.rows,${params}.cols);case\`applyBodyCharFormat\`:return ${host}.applyBodyCharFormat(${params}.section,${params}.paragraph,${params}.start,${params}.end,${params}.format);case\`applyBodyParaFormat\`:return ${host}.applyBodyParaFormat(${params}.section,${params}.paragraph,${params}.format);case\`applyCellCharFormat\`:return ${host}.applyCellCharFormat(${params}.section,${params}.paragraph,${params}.control,${params}.cellIndex,${params}.cellPara,${params}.start,${params}.end,${params}.format);case\`applyCellParaFormat\`:return ${host}.applyCellParaFormat(${params}.section,${params}.paragraph,${params}.control,${params}.cellIndex,${params}.cellPara,${params}.format);${tableEditRoutes(host, params)}case\`applyTextCommand\`:`
}

/** Needles proving all three patch sites (class, handlers, routes) landed. */
const COMPLETE_NEEDLES = [
  PREPARE_TEXT_MARK,
  'listBodyParagraphs(){this.syncGeneration()',
  'setField(e,t){this.syncGeneration()',
  'listTables(){this.syncGeneration()',
  'replaceCell(e,t,n,r,i){this.syncGeneration()',
  'insertBodyParagraphs(e,t,n){this.syncGeneration()',
  'async insertFilledParagraphs(e,t,n){if(!Array.isArray',
  'insertTable(e,t,n,r){this.syncGeneration()',
  'findOrCreateFontId(String(a.fontName))',
  'applyCharFormatInCell(e,t,n,r,i,a,o,JSON.stringify(c))',
  'insertTableRow(e,t,n,r,i){this.syncGeneration()',
  'setColumnDef(e,t,n,r,i){this.syncGeneration()',
  ...HANDLER_SIGNATURES.map(([name, params]) => `async ${name}(${params}){if(await `),
  ...HANDLER_SIGNATURES.map(([name]) => `case\`${name}\`:`),
]

export function prepareSurfaceComplete(js) {
  return COMPLETE_NEEDLES.every((needle) => js.includes(needle))
}

export function exposePrepareTextCommand(js) {
  if (prepareSurfaceComplete(js)) return js
  if (js.includes(PREPARE_TEXT_MARK)) {
    throw new StaleSnapshotError('prepareTextCommand surface is incomplete')
  }
  const snap = js.match(PREPARE_SNAP_RE)
  if (!snap) {
    throw new Error(
      'rhwp-studio paragraph snapshot helper changed — update exposePrepareTextCommand()',
    )
  }
  const next = js
    .replace(
      PREPARE_CLASS_RE,
      `selectedTextSha256:$1}}${prepareAgentMethods(snap[1])}async applyTextCommand($2){`,
    )
    .replace(PREPARE_HANDLER_RE, (_, ready, agent) => prepareAgentHandlers(ready, agent))
    .replace(PREPARE_ROUTE_RE, (_, guard, params, host) => prepareAgentRoutes(guard, params, host))
  if (!prepareSurfaceComplete(next)) {
    throw new Error(
      'rhwp-studio prepareTextCommand surface changed — update exposePrepareTextCommand()',
    )
  }
  return next
}

export function hasPrepareTextCommand(js) {
  return js.includes(PREPARE_TEXT_MARK)
}
