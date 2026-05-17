const { app, BrowserWindow, ipcMain } = require('electron')

let chatgptWindow
let geminiWindow
let controlWindow

function createWindow() {
  chatgptWindow = new BrowserWindow({ width: 800, height: 1000, x: 0, y: 0 })
  chatgptWindow.loadURL('https://chatgpt.com')

  geminiWindow = new BrowserWindow({ width: 800, height: 1000, x: 810, y: 0 })
  geminiWindow.loadURL('https://gemini.google.com')

  controlWindow = new BrowserWindow({
    width: 600, height: 500, x: 400, y: 100,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  controlWindow.loadFile('control.html')
}

app.whenReady().then(() => { createWindow() })

// ── Hàm chờ LLM trả lời xong (dùng snapshot thay vì countScript) ──
async function waitForStable(win, extractScript, previousSnapshot) {

  // Bước 1: chờ text KHÁC với snapshot cũ (tức là response mới bắt đầu)
  let attempts = 0
  while (true) {
    await new Promise(r => setTimeout(r, 300))
    let current = ''
    try {
      current = await win.webContents.executeJavaScript(extractScript)
    } catch (e) {}
    if (current && current !== previousSnapshot) break
    attempts++
    if (attempts > 100) {  // 30 giây hard timeout
      console.log('timeout waiting for new response')
      break
    }
  }

  // Bước 2: chờ text ổn định
  // Bước 2: chờ text ổn định
  let previous = ''
  let stableCount = 0
  let attempts2 = 0
  while (true) {
    await new Promise(r => setTimeout(r, 800))
    let current = ''
    try {
      current = await win.webContents.executeJavaScript(extractScript)
    } catch (e) { continue }

    if (current && current === previous) {
      stableCount++
      if (stableCount >= 2) {
        console.log('stable result:', current.slice(0, 200))  // thêm dòng này
        break
      }
    } else {
      stableCount = 0
    }
    previous = current

    attempts2++
    if (attempts2 > 60) {
      console.log('waitForStable timeout at stable step')
      break
    }
  }
  return previous
}

// ── Scripts dùng chung ────────────────────────────────────
// Trong index.js — thay chatgptExtract và geminiExtract
const chatgptExtract = `
  (() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]')
    const last = msgs[msgs.length - 1]
    if (!last) return ''

    function extractText(node) {
      if (node.nodeType === 3) return node.textContent

      const tag = node.tagName?.toLowerCase()
      if (tag === 'br') return '\\n'

      // Bỏ qua MathML và annotation — chỉ giữ katex-html
      if (tag === 'math') return ''
      if (tag === 'annotation') return ''
      if (node.classList?.contains('katex-mathml')) return ''

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
      const blocks = ['p','div','li','h1','h2','h3','h4','h5','h6','blockquote','pre']
      let text = Array.from(node.childNodes).map(extractText).join('')
      if (blocks.includes(tag) && text.trim()) return text.trimEnd() + '\\n\\n'
      return text
    }

    return extractText(last).trim()
  })()
`

async function injectPrompt(win, prompt) {
  console.log('injectPrompt called, prompt length:', prompt.length, 'preview:', JSON.stringify(prompt.slice(0, 100)))
  await win.webContents.executeJavaScript(`
    (async () => {
      const editor = document.querySelector('[contenteditable="true"]')
      if (!editor) { console.log('NO EDITOR'); return }
      editor.focus()
      document.execCommand('insertText', false, ${JSON.stringify(prompt)})
      await new Promise(r => setTimeout(r, 0))
      console.log('FULL editor text:', JSON.stringify(editor.innerText))
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }))
    })()
  `)
}

// ── Hàm helper: lấy snapshot + inject + chờ kết quả ─────
async function snapshotInjectAndWait(wins, extractScripts, injectFn) {
  console.log('snapshotInjectAndWait called, wins:', wins.length)
  const snapshots = []

  for (let i = 0; i < wins.length; i++) {
    let snapshot = ''
    try {
      snapshot = await wins[i].webContents.executeJavaScript(extractScripts[i])
      console.log(`snapshot[${i}] length:`, snapshot.length)
    } catch (e) {
      console.log(`snapshot[${i}] error:`, e.message)
    }
    snapshots.push(snapshot)
  }

  for (let i = 0; i < wins.length; i++) {
    try {
      console.log(`injecting[${i}]...`)
      if (wins[i] && !wins[i].isDestroyed()) {
        await injectFn(wins[i], i)
        console.log(`injecting[${i}] done`)
      }
    } catch (err) {
      console.error(`Inject error [${i}]:`, err.message)
    }
  }

  return Promise.all(
    wins.map((win, i) => waitForStable(win, extractScripts[i], snapshots[i]))
  )
}

// ── Send prompt ban đầu ───────────────────────────────────
ipcMain.on('send-prompt', async (event, prompt) => {

  const wins = [chatgptWindow, geminiWindow]
  const extracts = [chatgptExtract, geminiExtract]

  snapshotInjectAndWait(wins, extracts, (win) => injectPrompt(win, prompt))
    .then(([chatgptResult, geminiResult]) => {
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('chatgpt-response', chatgptResult)
        controlWindow.webContents.send('gemini-response', geminiResult)
      }
    })
})

// ── Redistribute ──────────────────────────────────────────
ipcMain.on('redistribute-prompt', async (event, { chatgpt, gemini }) => {

  const wins = [chatgptWindow, geminiWindow]
  const extracts = [chatgptExtract, geminiExtract]
  const prompts = [chatgpt, gemini]

  console.log('=== BACKEND NHẬN REDISTRIBUTE ===')
  console.log('chatgpt prompt:', chatgpt)
  console.log('gemini prompt:', gemini)
  console.log('chatgpt length:', chatgpt?.length)
  console.log('chatgpt raw:', JSON.stringify(chatgpt))
  

  snapshotInjectAndWait(wins, extracts, (win, i) => injectPrompt(win, prompts[i]))
    .then(([chatgptResult, geminiResult]) => {
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('chatgpt-response', chatgptResult)
        controlWindow.webContents.send('gemini-response', geminiResult)
      }
    })
})