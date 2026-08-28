const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs   = require('fs')

const baseDir = app.isPackaged
  ? path.dirname(process.execPath)
  : __dirname

app.setPath('userData', path.join(baseDir, 'appdata'))

const APPDATA_DIR = app.getPath('userData')
 
// ── Layout bounds ─────────────────────────────────────────
const { screen } = require('electron')

// Tính sau khi app ready để screen API hoạt động
function getLayoutBounds() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  // Control panel: chiếm 60% chiều rộng, căn giữa-trái
  const ctrlW = Math.round(sw * 0.60)
  const ctrlH = Math.round(sh * 0.65)
  const ctrlX = 0
  const ctrlY = 0

  // LLM windows: phần còn lại bên phải
  const llmX = ctrlW
  const llmW = sw - ctrlW
  const llmH = sh

  // Tab strip: góc phải, nằm cạnh LLM
  const tabX = sw - 36
  const tabY = Math.round(sh * 0.15)

  return {
    CTRL_BOUNDS: { x: ctrlX, y: ctrlY, width: ctrlW, height: ctrlH },
    LLM_BOUNDS:  { x: llmX,  y: 0,     width: llmW,  height: llmH  },
    TAB_BOUNDS:  { x: tabX,  y: tabY,  width: 36,    height: 200   },
  }
}
 
// ── Window refs ───────────────────────────────────────────
let chatgptWindow
let geminiWindow
let claudeWindow
let grokWindow
let controlWindow
let tabWindow
 
// ── Account state ─────────────────────────────────────────
let accountState = { chatgpt: 1, gemini: 1, claude: 1, grok: 1 }
 
const LLM_URLS = {
  chatgpt: 'https://chatgpt.com',
  gemini:  'https://gemini.google.com',
  claude:  'https://claude.ai',
  grok:    'https://grok.com',
}
 
function makeWebPrefs(llm, accountNum) {
  return { partition: `persist:profile${accountNum}` }
}
 
// ── Usage tracking ────────────────────────────────────────
const LOG_PATH       = path.join(APPDATA_DIR, 'usage-log.json')
const PROJECTS_PATH  = path.join(APPDATA_DIR, 'projects.json')
const SCRATCH_PATH   = path.join(APPDATA_DIR, 'scratch.json')
const NOTE_PATH       = path.join(APPDATA_DIR, 'note.json')
 
function getToday() {
  return new Date().toISOString().slice(0, 10)
}
 
function loadLog() {
  try {
    if (fs.existsSync(LOG_PATH)) {
      return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'))
    }
  } catch (e) {}
  return { total: 0, sessions: [] }
}
 
function saveLog(log) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2))
  } catch (e) {
    console.error('saveLog error:', e.message)
  }
}
 
function pruneLog(log) {
  const today     = getToday()
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  log.sessions = log.sessions.filter(s => s.date === today || s.date === yesterday)
  return log
}
 
function addDuration(seconds) {
  const log   = pruneLog(loadLog())
  const today = getToday()
  log.total  += seconds
  const session = log.sessions.find(s => s.date === today)
  if (session) {
    session.duration += seconds
  } else {
    log.sessions.push({ date: today, duration: seconds })
  }
  saveLog(log)
  return log
}
 
function getUsageStats() {
  const log       = pruneLog(loadLog())
  const today     = getToday()
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const todaySec  = log.sessions.find(s => s.date === today)?.duration     || 0
  const yestSec   = log.sessions.find(s => s.date === yesterday)?.duration || 0
  return { total: log.total, today: todaySec, yesterday: yestSec }
}
 
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}h${String(m).padStart(2,'0')}m${String(s).padStart(2,'0')}s`
}
 
// ── Processing timer ──────────────────────────────────────
let processingStart  = null
let pendingResponses = 0
 
function startProcessing() {
  processingStart  = Date.now()
  pendingResponses = 4
  console.log('processing started')
}
 
function onResponseReceived() {
  // Stop ngay khi LLM đầu tiên trả về
  stopProcessing()
}
 
function stopProcessing() {
  if (processingStart === null) return
  const elapsed = Math.round((Date.now() - processingStart) / 1000)
  processingStart  = null
  pendingResponses = 0
  console.log('processing stopped, elapsed:', elapsed, 's')
 
  addDuration(elapsed)
  const stats = getUsageStats()
 
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('usage-update', {
      today:     formatDuration(stats.today),
      yesterday: formatDuration(stats.yesterday),
      total:     formatDuration(stats.total),
    })
  }
}

// ── Project state ─────────────────────────────────────────
let projectState = {
  current: null,
  projects: {}
}

let isRestoring = false

function loadProjects() {
  try {
    if (fs.existsSync(PROJECTS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8'))
      projectState = parsed
    }
  } catch (e) {
    console.log('loadProjects error — using empty state:', e.message)
    projectState = { current: null, projects: {} }
  }
}

function saveProjects() {
  try {
    fs.mkdirSync(path.dirname(PROJECTS_PATH), { recursive: true })
    fs.writeFileSync(PROJECTS_PATH, JSON.stringify(projectState, null, 2))
  } catch (e) {
    console.log('saveProjects error:', e.message)
  }
}

// ── Scratch state (Save/Load toàn cục, không gắn project) ──
let scratchState = { urls: {} }

function loadScratch() {
  try {
    if (fs.existsSync(SCRATCH_PATH)) {
      scratchState = JSON.parse(fs.readFileSync(SCRATCH_PATH, 'utf8'))
    }
  } catch (e) {
    console.log('loadScratch error — using empty state:', e.message)
    scratchState = { urls: {} }
  }
}

function saveScratch() {
  try {
    fs.mkdirSync(path.dirname(SCRATCH_PATH), { recursive: true })
    fs.writeFileSync(SCRATCH_PATH, JSON.stringify(scratchState, null, 2))
  } catch (e) {
    console.log('saveScratch error:', e.message)
  }
}

// ── Note state (scratchpad ý tưởng, độc lập với project/scratch) ──
let noteState = { text: '' }

function loadNote() {
  try {
    if (fs.existsSync(NOTE_PATH)) {
      noteState = JSON.parse(fs.readFileSync(NOTE_PATH, 'utf8'))
    }
  } catch (e) {
    console.log('loadNote error — using empty state:', e.message)
    noteState = { text: '' }
  }
}

function saveNote(text) {
  try {
    noteState = { text }
    fs.mkdirSync(path.dirname(NOTE_PATH), { recursive: true })
    fs.writeFileSync(NOTE_PATH, JSON.stringify(noteState, null, 2))
  } catch (e) {
    console.log('saveNote error:', e.message)
  }
}

// ── Log buffer (mirror console cho /debug log) ────────────
const LOG_BUFFER_MAX = 50
const logBuffer = []

function appLog(...args) {
  const line = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ')
  const entry = `[${new Date().toISOString().slice(11,19)}] ${line}`
  console.log(entry)
  logBuffer.push(entry)
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift()
}

// ── IPC: /proj set ────────────────────────────────────────
// llmNum: 1=chatgpt 2=gemini 3=claude 4=grok
ipcMain.on('proj-set', (event, { n, llmNum, url }) => {
  const llmKey = LLM_KEYS[llmNum - 1]
  if (!llmKey) {
    event.reply('proj-result', { ok: false, msg: `Invalid LLM id: ${llmNum}` })
    return
  }
  if (!projectState.projects[n]) {
    projectState.projects[n] = { name: '', acc: null, urls: {} }
  }
  projectState.projects[n].urls[llmKey] = url
  saveProjects()
  appLog(`proj-set: project ${n} / ${llmKey} → ${url}`)
  event.reply('proj-result', {
    ok: true,
    msg: `Project ${n} — ${llmKey} set to ${url}`
  })
})

// ── IPC: /proj name ───────────────────────────────────────
ipcMain.on('proj-name', (event, { n, label }) => {
  if (!projectState.projects[n]) {
    projectState.projects[n] = { name: '', acc: null, urls: {} }
  }
  projectState.projects[n].name = label
  saveProjects()
  appLog(`proj-name: project ${n} → "${label}"`)
  event.reply('proj-result', {
    ok: true,
    msg: `Project ${n} named "${label}"`
  })
})

// ── IPC: /proj acc ────────────────────────────────────────
ipcMain.on('proj-acc', (event, { n, profile }) => {
  if (!projectState.projects[n]) {
    projectState.projects[n] = { name: '', acc: null, urls: {} }
  }
  projectState.projects[n].acc = profile
  saveProjects()
  appLog(`proj-acc: project ${n} → profile ${profile}`)
  event.reply('proj-result', {
    ok: true,
    msg: `Project ${n} bound to profile ${profile}`
  })
})

// ── IPC: /proj go ─────────────────────────────────────────
ipcMain.on('proj-go', (event, { n }) => {
  const proj = projectState.projects[n]
  if (!proj) {
    event.reply('proj-result', { ok: false, msg: `Project ${n} does not exist` })
    return
  }
  if (isRestoring) {
    event.reply('proj-result', { ok: false, msg: 'Cannot switch project — restore in progress' })
    return
  }

  // Switch acc nếu project có bind profile
  if (proj.acc !== null) {
    LLM_KEYS.forEach(k => switchLLMAccount(k, proj.acc))
  }

  // Load URLs — chỉ LLM nào có URL mới navigate
  const wins = {
    chatgpt: chatgptWindow, gemini: geminiWindow,
    claude: claudeWindow,   grok:   grokWindow
  }
  LLM_KEYS.forEach(k => {
    if (proj.urls[k] && wins[k] && !wins[k].isDestroyed()) {
      wins[k].loadURL(proj.urls[k])
      appLog(`proj-go: ${k} → ${proj.urls[k]}`)
    }
  })

  projectState.current = n
  saveProjects()

  const label = proj.name ? `"${proj.name}"` : `(unnamed)`
  event.reply('proj-result', {
    ok: true,
    msg: `Switched to Project ${n} — ${label}`,
    current: { n, label: proj.name || '' }
  })
})

// ── IPC: /proj del ────────────────────────────────────────
ipcMain.on('proj-del', (event, { n, llmNum }) => {
  if (!projectState.projects[n]) {
    event.reply('proj-result', { ok: false, msg: `Project ${n} does not exist` })
    return
  }
  if (llmNum !== undefined) {
    const llmKey = LLM_KEYS[llmNum - 1]
    if (!llmKey) {
      event.reply('proj-result', { ok: false, msg: `Invalid LLM id: ${llmNum}` })
      return
    }
    delete projectState.projects[n].urls[llmKey]
    saveProjects()
    appLog(`proj-del: project ${n} / ${llmKey} URL removed`)
    event.reply('proj-result', {
      ok: true,
      msg: `Removed ${llmKey} URL from Project ${n}`
    })
  } else {
    const label = projectState.projects[n].name || '(unnamed)'
    delete projectState.projects[n]
    if (projectState.current === n) projectState.current = null
    saveProjects()
    appLog(`proj-del: project ${n} deleted`)
    event.reply('proj-result', {
      ok: true,
      msg: `Project ${n} — "${label}" deleted`,
      current: projectState.current
    })
  }
})

// ── IPC: /new ─────────────────────────────────────────────
ipcMain.on('cmd-new', (event) => {
  if (isRestoring) {
    event.reply('proj-result', { ok: false, msg: 'Cannot reset — restore in progress' })
    return
  }
  const wins = {
    chatgpt: chatgptWindow, gemini: geminiWindow,
    claude: claudeWindow,   grok:   grokWindow
  }
  Object.entries(wins).forEach(([k, w]) => {
    if (w && !w.isDestroyed()) w.loadURL(LLM_URLS[k])
  })
  projectState.current = null
  saveProjects()
  appLog('cmd-new: all LLMs reset to homepage, current project cleared')
  event.reply('proj-result', {
    ok: true,
    msg: 'All LLMs reset to homepage — no active project',
    current: null
  })
})

// ── IPC: /debug ───────────────────────────────────────────
ipcMain.on('cmd-debug', (event, { sub }) => {
  if (sub === 'log') {
    event.reply('proj-result', {
      ok: true,
      lines: logBuffer.slice(-20),
      type: 'debug-log'
    })
  } else if (sub === 'state') {
    const state = {
      current_project: projectState.current,
      account: accountState,
      isRestoring,
      projects_loaded: Object.keys(projectState.projects).length,
      last_log: logBuffer[logBuffer.length - 1] || '—'
    }
    event.reply('proj-result', {
      ok: true,
      lines: Object.entries(state).map(([k,v]) => `${k}: ${JSON.stringify(v)}`),
      type: 'debug-state'
    })
  } else if (sub === 'projects') {
    const lines = Object.entries(projectState.projects).map(([n, p]) =>
      `[${n}] ${p.name || '(unnamed)'} | acc:${p.acc ?? 'free'} | urls:${Object.keys(p.urls).join(',') || 'none'}`
    )
    event.reply('proj-result', {
      ok: true,
      lines: lines.length ? lines : ['No projects saved'],
      type: 'debug-projects'
    })
  } else if (sub === 'reset') {
    // reset thực sự được xử lý sau khi confirm — IPC này chỉ trigger confirm ở renderer
    event.reply('proj-result', { ok: true, type: 'debug-reset-confirm' })
  }
})

ipcMain.on('cmd-debug-reset-confirmed', (event) => {
  try {
    if (fs.existsSync(PROJECTS_PATH)) fs.unlinkSync(PROJECTS_PATH)
    if (fs.existsSync(LOG_PATH))      fs.unlinkSync(LOG_PATH)
    projectState = { current: null, projects: {} }
    appLog('debug-reset: factory reset complete')
    event.reply('proj-result', {
      ok: true,
      msg: 'Factory reset complete — all project data and usage history deleted',
      current: null
    })
  } catch (e) {
    event.reply('proj-result', { ok: false, msg: `Reset failed: ${e.message}` })
  }
})

// ── IPC: scratch save ─────────────────────────────────────
ipcMain.on('scratch-save', (event) => {
  const wins = {
    chatgpt: chatgptWindow, gemini: geminiWindow,
    claude: claudeWindow,   grok:   grokWindow
  }
  const urls = {}
  for (const [key, win] of Object.entries(wins)) {
    if (win && !win.isDestroyed()) {
      urls[key] = win.webContents.getURL()
    }
  }
  scratchState = { urls }
  saveScratch()
  appLog(`scratch-save: ${Object.keys(urls).join(', ')}`)
  event.reply('scratch-result', {
    ok: true,
    msg: 'Đã lưu URL hiện tại của 4 LLM vào bộ nhớ tạm'
  })
})

// ── IPC: scratch load ─────────────────────────────────────
ipcMain.on('scratch-load', (event) => {
  if (isRestoring) {
    event.reply('scratch-result', { ok: false, msg: 'Không thể load — đang restore session' })
    return
  }
  const urls = scratchState.urls || {}
  if (Object.keys(urls).length === 0) {
    event.reply('scratch-result', { ok: false, msg: 'Chưa có dữ liệu Save nào được lưu' })
    return
  }
  const wins = {
    chatgpt: chatgptWindow, gemini: geminiWindow,
    claude: claudeWindow,   grok:   grokWindow
  }
  LLM_KEYS.forEach(k => {
    if (urls[k] && wins[k] && !wins[k].isDestroyed()) {
      wins[k].loadURL(urls[k])
      appLog(`scratch-load: ${k} → ${urls[k]}`)
    }
  })
  event.reply('scratch-result', {
    ok: true,
    msg: 'Đã load 4 URL từ bộ nhớ tạm'
  })
})

// ── IPC: note get/save ─────────────────────────────────────
ipcMain.on('note-get', (event) => {
  event.reply('note-content', noteState.text || '')
})

ipcMain.on('note-save', (event, { text }) => {
  saveNote(text)
})

// ── Restore on startup ────────────────────────────────────
function restoreSession() {
  loadProjects()
  loadScratch()
  const n = projectState.current
  if (!n || !projectState.projects[n]) {
    appLog('restore: no previous session')
    return
  }
  isRestoring = true
  appLog(`restore: resuming project ${n}`)
  const proj = projectState.projects[n]
  const wins = {
    chatgpt: chatgptWindow, gemini: geminiWindow,
    claude: claudeWindow,   grok:   grokWindow
  }

  if (proj.acc !== null) {
    LLM_KEYS.forEach(k => switchLLMAccount(k, proj.acc))
  }

  const urlEntries = Object.entries(proj.urls)
  if (urlEntries.length === 0) {
    isRestoring = false
    return
  }

  let loaded = 0
  urlEntries.forEach(([k, url]) => {
    const w = wins[k]
    if (!w || w.isDestroyed()) { loaded++; checkRestoreDone(urlEntries.length); return }
    w.webContents.once('did-finish-load', () => {
      loaded++
      appLog(`restore: ${k} loaded`)
      if (loaded >= urlEntries.length) {
        isRestoring = false
        appLog('restore: complete')
        if (controlWindow && !controlWindow.isDestroyed()) {
          controlWindow.webContents.send('restore-complete', {
            n,
            label: proj.name || ''
          })
        }
      }
    })
    w.loadURL(url)
  })
}

function checkRestoreDone(total) {
  // helper không cần — logic inline ở trên đã đủ
}

function getLayoutBounds() {
  const { screen } = require('electron')
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const ctrlW = Math.round(sw * 0.60)
  const ctrlH = Math.round(sh * 0.65)
  const llmX  = ctrlW
  const llmW  = sw - ctrlW - 36  // ← nhường 36px cho tab
  const tabX  = sw - 36
  const tabY  = Math.round(sh * 0.15)
  return {
    CTRL_BOUNDS: { x: 0,    y: 0,    width: ctrlW, height: ctrlH },
    LLM_BOUNDS:  { x: llmX, y: 0,    width: llmW,  height: sh    },
    TAB_BOUNDS:  { x: tabX, y: tabY, width: 36,    height: 200   },
  }
}

function createLLMWindow(llm, LLM_BOUNDS) {
  const win = new BrowserWindow({
    ...LLM_BOUNDS,
    show: true,
    webPreferences: makeWebPrefs(llm, accountState[llm])
  })
  win.loadURL(LLM_URLS[llm])
  win.webContents.setBackgroundThrottling(false)
  win.setOpacity(0)
  win.setIgnoreMouseEvents(true)
  return win
}

function createWindow() {
  const { CTRL_BOUNDS, LLM_BOUNDS, TAB_BOUNDS } = getLayoutBounds()
  chatgptWindow = createLLMWindow('chatgpt', LLM_BOUNDS)
  geminiWindow  = createLLMWindow('gemini',  LLM_BOUNDS)
  claudeWindow  = createLLMWindow('claude',  LLM_BOUNDS)
  grokWindow    = createLLMWindow('grok',    LLM_BOUNDS)
 
  controlWindow = new BrowserWindow({
    ...CTRL_BOUNDS,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  controlWindow.loadFile('control.html')

  controlWindow.on('closed', () => {
    app.quit()
  })
 
  controlWindow.webContents.once('did-finish-load', () => {
    const stats = getUsageStats()
    controlWindow.webContents.send('usage-update', {
      today:     formatDuration(stats.today),
      yesterday: formatDuration(stats.yesterday),
      total:     formatDuration(stats.total),
    })
  })
 
  tabWindow = new BrowserWindow({
    ...TAB_BOUNDS,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  tabWindow.loadFile('tabs.html')
  setTimeout(() => restoreSession(), 800)
}
 
app.whenReady().then(() => {
  loadNote()
  createWindow()
})
 
// ── Stop button selectors ─────────────────────────────────
const STOP_SELECTORS = [
  'button[data-testid="stop-button"]',          // chatgpt
  'button[aria-label="Stop response"]',          // gemini
  'button[aria-label="Stop response"]',          // claude
  'button[aria-label="Dừng phản hồi mô hình"]', // grok
]
 
const USE_SEND_BUTTON = [true, true, true, true]
 
// ── waitForStreamEnd ──────────────────────────────────────
async function waitForStreamEnd(win, stopSelector, extractScript) {
  console.log(`waitForStreamEnd: selector="${stopSelector}"`)

  let appeared = false
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 20))
    try {
      const found = await win.webContents.executeJavaScript(
        `!!document.querySelector(${JSON.stringify(stopSelector)})`
      )
      if (found) { appeared = true; console.log('stop appeared'); break }
    } catch (e) {}
  }

  if (!appeared) {
    console.log('stop never appeared — waiting 1s then extract')
    await new Promise(r => setTimeout(r, 1000))

    // Thử extract lần 1
    let result = ''
    try {
      result = await win.webContents.executeJavaScript(extractScript)
    } catch (e) {}

    if (result.trim()) {
      console.log('got result after 1s:', result.slice(0, 80))
      return result
    }

    // Lần 2 — đợi thêm 1s
    await new Promise(r => setTimeout(r, 1000))
  } else {
    for (let i = 0; i < 250; i++) {
      await new Promise(r => setTimeout(r, 400))
      try {
        const found = await win.webContents.executeJavaScript(
          `!!document.querySelector(${JSON.stringify(stopSelector)})`
        )
        if (!found) { console.log('stop disappeared'); break }
      } catch (e) {}
      if (i === 249) console.log('hard timeout')
    }
    await new Promise(r => setTimeout(r, 300))
  }

  let result = ''
  try {
    result = await win.webContents.executeJavaScript(extractScript)
    console.log('extracted:', result.slice(0, 150))
  } catch (e) {
    console.log('extract error:', e.message)
  }
  return result
}
 
// ── Extract scripts ───────────────────────────────────────
const chatgptExtract = `
  (() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]')
    const last = msgs[msgs.length - 1]
    if (!last) return ''
    const extracted = extractText(last).trim()
    if (!extracted) return ''  // ← thêm dòng này, trigger retry
    function extractText(node) {
      if (node.nodeType === 3) return node.textContent
      const tag = node.tagName?.toLowerCase()
      if (tag === 'br') return '\\n'
      if (tag === 'math') return ''
      if (tag === 'annotation') return ''
      if (node.classList?.contains('katex-mathml')) return ''
      if (node.classList?.contains('entity-underline')) return '' + node.textContent.trim() + ''
      if (node.classList?.contains('truncate')) return ''
      const blocks = ['p','div','li','h1','h2','h3','h4','h5','h6','blockquote','pre']
      let text = Array.from(node.childNodes).map(extractText).join('')
      if (blocks.includes(tag) && text.trim()) return text.trimEnd() + '\\n\\n'
      return text
    }
    return extractText(last).trim()
  })()
`
 
const geminiExtract = `
  (() => {
    const msgs = document.querySelectorAll('message-content')
    const last = msgs[msgs.length - 1]
    if (!last) return ''
    function extractText(node) {
      if (node.nodeType === 3) return node.textContent
      const tag = node.tagName?.toLowerCase()
      if (tag === 'br') return '\\n'
      if (node.classList?.contains('follow-up-button')) return ''
      const blocks = ['p','div','li','h1','h2','h3','h4','h5','h6','blockquote','pre']
      let text = Array.from(node.childNodes).map(extractText).join('')
      if (blocks.includes(tag) && text.trim()) return text.trimEnd() + '\\n\\n'
      return text
    }
    return extractText(last).trim()
  })()
`
 
const claudeExtract = `
  (() => {
    const els = Array.from(document.querySelectorAll('[class*="markdown"]'))
    const last = els.reverse().find(el =>
      !el.textContent.includes('Searched the web') &&
      !el.textContent.includes('Searching the web') &&
      !el.textContent.includes('Working') &&
      el.textContent.trim().length > 0
    )
    if (!last) return ''
    function extractText(node) {
      if (node.nodeType === 3) return node.textContent
      const tag = node.tagName?.toLowerCase()
      if (tag === 'br') return '\\n'
      if (node.classList?.contains('text-nowrap')) return ''
      const blocks = ['p','div','li','h1','h2','h3','h4','h5','h6','blockquote','pre']
      let text = Array.from(node.childNodes).map(extractText).join('')
      if (blocks.includes(tag) && text.trim()) return text.trimEnd() + '\\n\\n'
      return text
    }
    return extractText(last).trim()
  })()
`
 
const grokExtract = `
  (() => {
    const msgs = Array.from(document.querySelectorAll('.response-content-markdown'))
    // Lấy cái cuối, bỏ qua nếu chỉ có 1 (có thể là câu hỏi)
    if (msgs.length < 2) return ''
    const last = msgs[msgs.length - 1]
    if (!last) return ''
    function extractText(node) {
      if (node.nodeType === 3) return node.textContent
      const tag = node.tagName?.toLowerCase()
      if (tag === 'br') return '\\n'
      if (node.classList?.contains('no-copy')) return ''
      const blocks = ['p','div','li','h1','h2','h3','h4','h5','h6','blockquote','pre']
      let text = Array.from(node.childNodes).map(extractText).join('')
      if (blocks.includes(tag) && text.trim()) return text.trimEnd() + '\\n\\n'
      return text
    }
    return extractText(last).trim()
  })()
`
 
// ── injectPrompt ──────────────────────────────────────────
async function injectPrompt(win, prompt, useSendButton = false) {
  console.log('injectPrompt, length:', prompt.length)
  await win.webContents.executeJavaScript(`
    (async () => {
      const editor = document.querySelector('[contenteditable="true"]')
      if (!editor) { console.log('NO EDITOR'); return }
      editor.focus()
 
      const allBtns = Array.from(document.querySelectorAll('button'))
      const allowBtn = allBtns.find(b => b.textContent.includes('Allow') || b.textContent.includes('Cho phép'))
      if (allowBtn) allowBtn.click()
 
      document.execCommand('insertText', false, ${JSON.stringify(prompt)})
      await new Promise(r => setTimeout(r, 300))
 
      let btn = null
      for (let i = 0; i < 10; i++) {
        btn = document.querySelector(
          'button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="Gửi"]'
        )
        if (btn) break
        await new Promise(r => setTimeout(r, 200))
      }
      if (btn) { btn.click(); console.log('SEND clicked') }
      else { console.log('NO SEND BUTTON') }
    })()
  `)
}
 
// ── snapshotInjectAndWait ─────────────────────────────────
async function snapshotInjectAndWait(wins, extractScripts, injectFn, onResult) {
  await Promise.all(wins.map(async (win, i) => {
    try {
      if (win && !win.isDestroyed()) await injectFn(win, i)
    } catch (err) {
      console.error(`inject error [${i}]:`, err.message)
    }
  }))
 
  wins.forEach((win, i) => {
    waitForStreamEnd(win, STOP_SELECTORS[i], extractScripts[i])
      .then(result => onResult(i, result))
  })
}
 
// ── Config ────────────────────────────────────────────────
const ALL_WINS     = () => [chatgptWindow, geminiWindow, claudeWindow, grokWindow]
const ALL_EXTRACTS = [chatgptExtract, geminiExtract, claudeExtract, grokExtract]
const LLM_KEYS     = ['chatgpt', 'gemini', 'claude', 'grok']
 
// ── send-prompt ───────────────────────────────────────────
ipcMain.on('send-prompt', async (event, { text, gen }) => {
  console.log('=== SEND-PROMPT ===', JSON.stringify(text.slice(0, 80)))
  startProcessing()
  const wins = ALL_WINS()
  snapshotInjectAndWait(wins, ALL_EXTRACTS,
    (win, i) => injectPrompt(win, text, USE_SEND_BUTTON[i]),
    (i, result) => {
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send(`${LLM_KEYS[i]}-response`, { result, gen })
      }
      onResponseReceived()
    }
  )
})

ipcMain.on('redistribute-prompt', async (event, { prompts, gen }) => {
  console.log('=== REDISTRIBUTE ===')
  startProcessing()
  const wins = ALL_WINS()
  const promptArr = LLM_KEYS.map(key => prompts[key] || '')

  snapshotInjectAndWait(wins, ALL_EXTRACTS,
    (win, i) => injectPrompt(win, promptArr[i], USE_SEND_BUTTON[i]),
    (i, result) => {
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send(`${LLM_KEYS[i]}-response`, { result, gen })
      }
      onResponseReceived()
    }
  )
})
 
// ── redistribute-prompt ───────────────────────────────────
ipcMain.on('redistribute-prompt', async (event, prompts) => {
  console.log('=== REDISTRIBUTE ===')
  startProcessing()
  const wins = ALL_WINS()
  const promptArr = LLM_KEYS.map(key => prompts[key] || '')
 
  snapshotInjectAndWait(wins, ALL_EXTRACTS,
    (win, i) => injectPrompt(win, promptArr[i], USE_SEND_BUTTON[i]),
    (i, result) => {
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send(`${LLM_KEYS[i]}-response`, result)
      }
      onResponseReceived()
    }
  )
})
 
// ── Tab toggle ────────────────────────────────────────────
ipcMain.on('tab-toggle', (event, { llm }) => {
  const wins = {
    chatgpt: chatgptWindow,
    gemini:  geminiWindow,
    claude:  claudeWindow,
    grok:    grokWindow,
  }

  // Ẩn tất cả
  Object.values(wins).forEach(w => {
    if (w && !w.isDestroyed()) {
      w.setOpacity(0)
      w.setIgnoreMouseEvents(true)
    }
  })

  // Hiện cái được chọn
  if (llm && wins[llm] && !wins[llm].isDestroyed()) {
    wins[llm].setOpacity(1)
    wins[llm].setIgnoreMouseEvents(false)
    wins[llm].focus()
  }
})
 
// ── Switch account ────────────────────────────────────────
function getLLMWin(llm) {
  if (llm === 'chatgpt') return chatgptWindow
  if (llm === 'gemini')  return geminiWindow
  if (llm === 'claude')  return claudeWindow
  if (llm === 'grok')    return grokWindow
}
 
function setLLMWin(llm, win) {
  if (llm === 'chatgpt') chatgptWindow = win
  if (llm === 'gemini')  geminiWindow  = win
  if (llm === 'claude')  claudeWindow  = win
  if (llm === 'grok')    grokWindow    = win
}
 
function switchLLMAccount(llm, accountNum) {
  const oldWin = getLLMWin(llm)
  if (oldWin && !oldWin.isDestroyed()) {
    oldWin.hide()
    oldWin.destroy()
  }
  accountState[llm] = accountNum

  const { LLM_BOUNDS } = getLayoutBounds()
  const newWin = new BrowserWindow({
    ...LLM_BOUNDS,
    show: true,
    webPreferences: makeWebPrefs(llm, accountNum)
  })
  newWin.loadURL(LLM_URLS[llm])
  newWin.webContents.setBackgroundThrottling(false)
  newWin.setOpacity(0)
  newWin.setIgnoreMouseEvents(true)
  setLLMWin(llm, newWin)
  console.log(`switched ${llm} → account ${accountNum}`)
}
 
ipcMain.on('switch-account', (event, { llm, accountNum }) => {
  if (llm === 'all') {
    LLM_KEYS.forEach(k => switchLLMAccount(k, accountNum))
  } else {
    switchLLMAccount(llm, accountNum)
  }
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('account-state', accountState)
  }
})
 
// ── Debug: get window bounds ──────────────────────────────
ipcMain.on('get-window-bounds', (event) => {
  const wins = {
    chatgpt: chatgptWindow, gemini: geminiWindow,
    claude:  claudeWindow,  grok:   grokWindow,
    control: controlWindow, tab:    tabWindow
  }
  const bounds = {}
  Object.entries(wins).forEach(([k, w]) => {
    if (w && !w.isDestroyed()) bounds[k] = w.getBounds()
  })
  console.log(JSON.stringify(bounds, null, 2))
  event.reply('window-bounds-result', bounds)
})
//__Lấy URL__
ipcMain.on('get-llm-url', (event, { llmNum }) => {
  const wins = [chatgptWindow, geminiWindow, claudeWindow, grokWindow]
  const win = wins[llmNum - 1]
  if (!win || win.isDestroyed()) {
    event.reply('llm-url-result', { ok: false, msg: 'Window not available' })
    return
  }
  const url = win.webContents.getURL()
  event.reply('llm-url-result', { ok: true, url, llmNum })
})
///---
ipcMain.on('check-visibility', async (event) => {
  const wins = {
    chatgpt: chatgptWindow,
    gemini:  geminiWindow,
    claude:  claudeWindow,
    grok:    grokWindow,
  }
  for (const [key, win] of Object.entries(wins)) {
    try {
      const result = await win.webContents.executeJavaScript(
        `({ visibility: document.visibilityState, hidden: document.hidden })`
      )
      console.log(`${key}:`, result)
    } catch (e) {
      console.log(`${key}: error`, e.message)
    }
  }
})
//---
ipcMain.on('check-grok', async (event) => {
  try {
    const result = await grokWindow.webContents.executeJavaScript(`
      ({
        visibility: document.visibilityState,
        hidden: document.hidden,
        readyState: document.readyState,
        url: location.href,
        editor: !!document.querySelector('[contenteditable="true"]'),
        sendBtn: !!document.querySelector('button[aria-label*="Gửi"]'),
        stopBtn: !!document.querySelector('button[aria-label="Dừng phản hồi mô hình"]'),
      })
    `)
    console.log('grok diagnosis:', result)
  } catch (e) {
    console.log('grok diagnosis error:', e.message)
  }
})
//---
ipcMain.on('check-claude', async (event) => {
  try {
    const result = await claudeWindow.webContents.executeJavaScript(`
      ({
        visibility: document.visibilityState,
        hidden: document.hidden,
        stopBtn: !!document.querySelector('button[aria-label="Stop response"]'),
        editor: !!document.querySelector('[contenteditable="true"]'),
        sendBtn: !!document.querySelector('button[aria-label*="Gửi"], button[aria-label*="Send"]'),
        markdowns: document.querySelectorAll('[class*="markdown"]').length,
        lastMarkdown: document.querySelectorAll('[class*="markdown"]')[document.querySelectorAll('[class*="markdown"]').length - 1]?.textContent?.slice(0, 100)
      })
    `)
    console.log('claude diagnosis:', result)
  } catch (e) {
    console.log('claude error:', e.message)
  }
})
//---
ipcMain.on('check-chatgpt', async (event) => {
  try {
    const result = await chatgptWindow.webContents.executeJavaScript(`
      ({
        visibility: document.visibilityState,
        hidden: document.hidden,
        stopBtn: !!document.querySelector('button[data-testid="stop-button"]'),
        sendBtn: !!document.querySelector('button[data-testid="send-button"]'),
        editor: !!document.querySelector('[contenteditable="true"]'),
        editorText: document.querySelector('[contenteditable="true"]')?.textContent?.slice(0, 50),
        lastMsg: document.querySelectorAll('[data-message-author-role="assistant"]').length,
        lastMsgText: document.querySelectorAll('[data-message-author-role="assistant"]')[document.querySelectorAll('[data-message-author-role="assistant"]').length - 1]?.textContent?.slice(0, 100)
      })
    `)
    console.log('chatgpt diagnosis:', result)
  } catch (e) {
    console.log('chatgpt error:', e.message)
  }
})
//Hàm cuối file
app.on('before-quit', () => {
  [chatgptWindow, geminiWindow, claudeWindow, grokWindow, tabWindow].forEach(w => {
    if (w && !w.isDestroyed()) w.destroy()
  })
})