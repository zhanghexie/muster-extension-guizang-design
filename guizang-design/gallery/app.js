const $ = (s, el = document) => el.querySelector(s)
const i18n = window.GZ_I18N
const t = i18n.t
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// 细线图标（24 网格，1.5 线宽，直角端点）
const ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"/>',
  works: '<path d="M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17"/><path d="M15.5 9.5h.01"/>',
  flow: '<path d="M6 4v6a4 4 0 0 0 4 4h8M14 10l4 4-4 4"/>',
  voice: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
  book: '<path d="M4 5.5C7 4.5 9.5 4.5 12 6.5c2.5-2 5-2 8-1V19c-3-1-5.5-1-8 1-2.5-2-5-2-8-1zM12 6.5V20"/>',
  arrow: '<path d="M7 17 17 7M8 7h9v9"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  search: '<path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20"/>',
}
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`

// 每个 skill 对应一个瑞士风主题（横幅动画区的底色），作品上的小色块也用它
const META = {
  'guizang-ppt-skill': { key: 'skill.ppt', theme: 'ikb', dot: '#002FA7' },
  'guizang-social-card-skill': { key: 'skill.card', theme: 'safety-orange', dot: '#FF6B35' },
  'guizang-page-skill': { key: 'skill.page', theme: 'lemon-green', dot: '#C5E803' },
  'humanizer-zh': { key: 'skill.humanizer', theme: 'lemon', dot: '#FFD500' },
  'guizang-voice': { key: 'skill.voice', theme: 'ikb', dot: '#737373' },
}
const meta = (n) => (META[n] ? { ...META[n], short: t(META[n].key) } : { short: n || t('skill.other'), dot: '#a3a3a3' })
const skillTag = (n) => `<span><i class="dot" style="--dot:${meta(n).dot}"></i>${esc(meta(n).short)}</span>`
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '.') : '')

let data = null
const state = { q: '', skill: 'all', exSkill: 'all' }

function toast(text) {
  const t = $('#toast')
  t.textContent = text
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600)
}
const local = (zh, en) => i18n.lang === 'en' ? en : zh
function start(prompt, title) {
  return ma.tasks.create(title || local('歸藏设计 · 创作', 'Guizang design'), prompt)
}

// ---------- 组件 ----------
const head = (title, desc) => `<header class="head"><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ''}</header>`
const secHead = (title, more) => `<div class="sec-head"><h2>${esc(title)}</h2>${more ? `<a class="more" href="${more}">${t('more')}${icon('right')}</a>` : ''}</div>`

function thumb(w) {
  if (w.missing) return `<div class="thumb missing">${t('work.missing')}</div>`
  if (w.thumb) return `<div class="thumb"><img src="${esc(w.thumb)}" alt="" loading="lazy"></div>`
  if (w.kind === 'image') {
    const imgs = (w.files?.length ? w.files : [w.url]).slice(0, 3)
    return `<div class="thumb stack">${imgs.map((f) => `<img src="${esc(f)}" alt="" loading="lazy">`).join('')}</div>`
  }
  if (w.kind === 'html' || /\.html?$/i.test(w.relativePath || '')) {
    return `<div class="thumb work-preview" data-preview="${esc(w.id)}" aria-busy="true"></div>`
  }
  return `<div class="thumb missing">${esc(w.relativePath?.split('.').pop()?.toUpperCase() || t('skill.other'))}</div>`
}

let previewObserver
const previewRequests = new Map()

async function showPreview(element, work) {
  const key = JSON.stringify([work.id, work.sessionId, work.relativePath, work.updatedAt])
  let request = previewRequests.get(key)
  try {
    if (!request) {
      request = work.relativePath
        ? ma.tasks.thumbnail(work.taskRef || work.sessionId, work.relativePath)
        : ma.agent.domain.query('work.read', { id: work.id }).then(row => ma.exports.thumbnailHtml(row.html))
      previewRequests.set(key, request)
    }
    const { dataUrl } = await request
    if (!element.isConnected) return
    const image = document.createElement('img')
    image.alt = local(work.title + '的首屏预览', 'Preview of ' + work.title)
    image.src = dataUrl
    element.replaceChildren(image)
  } catch (error) {
    if (!element.isConnected) return
    element.textContent = local('预览暂不可用', 'Preview unavailable')
    element.title = String(error.message || error)
  } finally {
    if (previewRequests.get(key) === request) previewRequests.delete(key)
    element.removeAttribute('aria-busy')
  }
}

function observePreviews(root) {
  previewObserver?.disconnect()
  const works = new Map(data.works.map(work => [work.id, work]))
  const loadVisible = element => {
    const work = works.get(element.dataset.preview)
    if (work) void showPreview(element, work)
  }
  if (typeof IntersectionObserver === 'function') {
    previewObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        previewObserver.unobserve(entry.target)
        loadVisible(entry.target)
      }
    })
  }
  root.querySelectorAll('[data-preview]').forEach(element => {
    if (previewObserver) previewObserver.observe(element)
    else loadVisible(element)
  })
}

// 点卡片 = 打开作品；「做同款」= 在新对话里按这份作品的主题和版式做一份新内容；垃圾桶 = 移出作品库（不删文件）
function workCard(w) {
  const kicker = [skillTag(w.skill), w.files?.length > 1 ? `<span>${t('work.count', w.files.length)}</span>` : '', w.column ? `<span>${esc(w.column)}</span>` : ''].filter(Boolean).join('<span class="sep">·</span>')
  return `<article class="work">
    ${w.missing ? `<div class="work-open">${thumb(w)}</div>` : `<a class="work-open" href="#" data-open="${esc(w.id)}" title="${esc(t('work.open'))}">${thumb(w)}</a>`}
    <div class="work-body">
      <div class="work-kicker mono">${kicker}</div>
      <div class="work-title">${esc(w.title)}</div>
      ${w.theme ? `<div class="work-tags">${esc(t('work.theme', w.theme))}</div>` : ''}
    </div>
    <div class="work-foot">
      <span class="date">${date(w.updatedAt)}</span>
      ${w.sessionId ? `<button class="btn" data-resume="${esc(w.id)}">${local('继续修改','Continue editing')}</button>` : ''}
      <button class="btn" data-next="${esc(w.id)}" title="${esc(t('work.nextTip'))}">${t('work.next')}</button>
      <button class="ibtn" data-remove="${esc(w.id)}" title="${esc(t('work.remove'))}" aria-label="${esc(t('work.removeLabel'))}">${icon('trash')}</button>
    </div>
  </article>`
}

function flowCard(r, i) {
  return `<article class="flow">
    <span class="mono">${t('flow.kicker', String(i + 1).padStart(2, '0'))}</span>
    <h3>${esc(r.title)}</h3>
    <div class="steps">${r.steps.map(skillTag).join('<span class="arrow">→</span>')}</div>
    <button class="btn" data-recipe="${esc(r.id)}">${t('flow.use')}</button>
  </article>`
}

function exampleTable(list) {
  return `<div class="table">
    ${list.map((w) => `<div class="row">
      <div><div class="r-title">${esc(w.title)}<span class="r-skill">${skillTag(w.skill)}</span></div><div class="r-sub">${esc(w.summary || '')}</div></div>
      <div class="r-act"><a class="btn ghost" href="#" data-open="${esc(w.id)}">${t('open')}</a><button class="btn" data-next="${esc(w.id)}">${t('work.next')}</button></div>
    </div>`).join('')}
  </div>`
}

const emptyWorks = () => `<div class="empty">${t('works.empty')}</div>`

// 档案是 Markdown：只渲染标题、列表和段落
function md(text) {
  const out = []
  let list = false
  for (const line of text.split('\n')) {
    const l = line.trim()
    if (/^- /.test(l)) { if (!list) { out.push('<ul>'); list = true } out.push(`<li>${esc(l.slice(2))}</li>`); continue }
    if (list) { out.push('</ul>'); list = false }
    if (/^# /.test(l)) out.push(`<p class="profile-title">${esc(l.slice(2))}</p>`)
    else if (/^#{2,} /.test(l)) out.push(`<h4>${esc(l.replace(/^#+ /, ''))}</h4>`)
    else if (l && !/^```/.test(l)) out.push(`<p>${esc(l)}</p>`)
  }
  if (list) out.push('</ul>')
  return out.join('')
}

function voicePanel(full) {
  const v = data.voice
  const side = `<div class="panel">
    <span class="mono">${t('voice.status')}</span>
    <div class="state ${v.exists ? 'ok' : ''}"><i></i>${t(v.exists ? 'voice.exists' : 'voice.none')}</div>
    ${v.exists && v.updated ? `<p>${esc(v.updated)}</p>` : ''}
    <div class="actions">
      
      <button class="btn ghost" data-voice="articles">${t('voice.articles')}</button>
    </div>
    <div class="path">${esc(v.path)}</div>
  </div>`
  const main = v.exists
    ? `<div class="panel profile">${md(full ? v.text : v.text.split('\n').slice(0, 14).join('\n'))}</div>`
    : `<div class="panel"><span class="mono">${t('voice.howKicker')}</span><h3>${t('voice.howTitle')}</h3><ol>
        <li>${t('voice.how1')}</li>
        <li>${t('voice.how2')}</li>
        <li>${t('voice.how3')}</li></ol></div>`
  return `<div class="voice">${main}${side}</div>`
}

function pills(key, list) {
  const skills = [...new Set(list.map((w) => w.skill).filter(Boolean))]
  const n = (s) => (s === 'all' ? list.length : list.filter((w) => w.skill === s).length)
  return `<div class="pills">${['all', ...skills].map((s) => `<button class="pill" data-seg="${key}" data-skill="${s}" aria-pressed="${state[key] === s}">${s === 'all' ? t('pills.all') : esc(meta(s).short)} (${n(s)})</button>`).join('')}</div>`
}

// ---------- 视图 ----------
const VIEWS = {
  home() {
    const { skills, works, recipes, examples, columns, voice } = data
    return `${head(t('home.title'), t('home.desc'))}
      <div class="stats">
        <div class="stat"><span class="mono">${t('stat.works')}</span><div class="val">${works.length}</div><div class="sub">${t('stat.worksSub')}</div></div>
        <div class="stat"><span class="mono">${t('stat.columns')}</span><div class="val">${columns.length}</div><div class="sub">${t('stat.columnsSub', columns.reduce((n, c) => n + c.issues, 0))}</div></div>
        <div class="stat"><span class="mono">${t('stat.flows')}</span><div class="val">${recipes.length}</div><div class="sub">${t('stat.flowsSub')}</div></div>
        <div class="stat"><span class="mono">${t('stat.voice')}</span><div class="val">${t(voice.exists ? 'stat.voiceYes' : 'stat.voiceNo')}</div><div class="sub">${voice.exists ? esc(voice.updated || '') : t('stat.voiceSub')}</div></div>
      </div>
      <section>${secHead(t('sec.start'))}
        <div class="banners">${skills.map((s) => `
          <button class="banner" data-starter="${esc(s.name)}" data-theme="${meta(s.name).theme}">
            <span class="b-text"><span class="b-title">${esc(s.title)}</span><span class="b-desc">${esc(s.blurb)}</span><span class="b-cmd">/${esc(s.name)}</span></span>
            <span class="b-art"><canvas aria-hidden="true"></canvas><span class="b-go">${icon('arrow')}</span></span>
          </button>`).join('')}</div>
      </section>
      <section class="sec">${secHead(t('sec.recent'), works.length > 6 ? '#/works' : null)}
        ${works.length ? `<div class="grid">${works.slice(0, 6).map(workCard).join('')}</div>` : emptyWorks()}
      </section>
      <section class="sec">${secHead(t('sec.flows'), '#/workflows')}<div class="flows">${recipes.slice(0, 3).map(flowCard).join('')}</div></section>
      <section class="sec">${secHead(t('sec.voice'), '#/voice')}${voicePanel(false)}</section>
      <section class="sec">${secHead(t('sec.examples'), '#/examples')}${exampleTable(examples.slice(0, 4))}</section>`
  },
  works() {
    const { works, columns } = data
    return `${head(t('works.title'), t('works.desc'))}<button class="btn" id="import-images">${local('导入图片作品','Import images')}</button>
      ${columns.length ? `${secHead(t('works.series'))}<div class="columns">${columns.map((c) => `
        <div class="column"><div class="c-body"><span class="mono">${t('works.issues', c.issues, date(c.latest.updatedAt))}</span><div class="c-name">${esc(c.name)}</div><div class="c-meta">${esc(t('works.latest', c.latest.title))}</div></div>
        <button class="btn" data-column="${esc(c.name)}">${t('works.newIssue')}</button></div>`).join('')}</div>` : ''}
      <div class="toolbar"><label class="search">${icon('search')}<input id="q" type="search" aria-label="${esc(t('works.search'))}" placeholder="${esc(t('works.search'))}" value="${esc(state.q)}"></label>${pills('skill', works)}</div>
      <div id="work-results">${workResults()}</div>`
  },
  workflows() {
    return `${head(t('flows.title'))}<div class="flows">${data.recipes.map(flowCard).join('')}</div>`
  },
  voice() {
    return `${head(t('voice.title'), t('voice.desc'))}${voicePanel(true)}`
  },
  examples() {
    const shown = data.examples.filter((w) => state.exSkill === 'all' || w.skill === state.exSkill)
    return `${head(t('examples.title'), t('examples.desc'))}
      <div class="toolbar">${pills('exSkill', data.examples)}</div>${exampleTable(shown)}`
  },
}

function workResults() {
  if (!data.works.length) return emptyWorks()
  const query = state.q.trim().toLowerCase()
  const shown = data.works.filter(work =>
    (state.skill === 'all' || work.skill === state.skill) &&
    [work.title, work.column, work.theme].join(' ').toLowerCase().includes(query))
  return shown.length ? `<div class="grid">${shown.map(workCard).join('')}</div>` : `<div class="empty">${t('works.noMatch')}</div>`
}

const route = () => (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0]
function render() {
  if (!data) return
  const view = VIEWS[route()] ? route() : 'home'
  document.querySelectorAll('.nav a').forEach(a => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
  document.querySelectorAll('[data-count="works"]').forEach((el) => (el.textContent = data.works.length || ''))
  // 左下角：插件版本和打包进来的各 skill 的提交
  $('#rail-foot').innerHTML = `<div class="v-head">${esc(t('rail.plugin', data.version || ''))}</div>${data.skills.map((s) => `<div class="v-row" title="${esc(s.name)}"><span>${esc(meta(s.name).short)}</span><span>${esc(s.source?.commit?.slice(0, 7) || '—')}</span></div>`).join('')}`
  const app = $('#app')
  const search = app.querySelector('#q')
  const selection = search === document.activeElement ? [search.selectionStart, search.selectionEnd] : null
  disposeBlobs.forEach(dispose => dispose?.())
  app.innerHTML = VIEWS[view]()
  const nextSearch = app.querySelector('#q')
  if (nextSearch && selection) {
    nextSearch.focus({ preventScroll: true })
    nextSearch.setSelectionRange(...selection)
  }
  observePreviews(app)
  disposeBlobs = Array.from(app.querySelectorAll('.banner'), (banner, i) => blobArt(banner, i + 1))
}
document.querySelectorAll('[data-icon]').forEach((el) => (el.outerHTML = icon(el.dataset.icon)))
// i18n.js 在 <head> 里跑的时候静态文案还不在 DOM 上，这里补一次
i18n.apply()

// ---------- 横幅动画区：融合的水球 ----------
// 几个水球慢慢游动，靠近时融成一团（metaball 场）。形状完全由 ASCII 字符组成：场强越高字符越密、越实，
// 边缘只剩稀疏的点。平时停在一帧；鼠标移上去渐渐动起来，移开后慢慢停下。
// 字色取该主题的 accent-on（蓝、橙上白色，黄、绿上墨色）——动画区里没有文字，只有纹理。
const GLYPHS = ' .·:-=+*#'
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
let disposeBlobs = []
function blobArt(banner, seed) {
  const art = $('.b-art', banner), canvas = $('canvas', art), ctx = canvas.getContext('2d')
  if (!ctx) return
  const cell = 8
  const rnd = (i) => { const x = Math.sin(seed * 97.13 + i * 12.9898) * 43758.5453; return x - Math.floor(x) }
  const blobs = Array.from({ length: 5 }, (_, i) => ({
    bx: 0.25 + rnd(i) * 0.5, by: 0.3 + rnd(i + 9) * 0.45,
    ax: 0.12 + rnd(i + 3) * 0.14, ay: 0.12 + rnd(i + 5) * 0.16,
    sp: 0.35 + rnd(i + 7) * 0.45, ph: rnd(i + 11) * 6.28, r: 0.1 + rnd(i + 13) * 0.07,
  }))
  let t = 4 + seed * 2.3, speed = 0, target = 0, raf = 0, last = 0, w = 0, h = 0, dpr = 1, rgb = [255, 255, 255]
  function size() {
    const r = art.getBoundingClientRect()
    dpr = Math.min(devicePixelRatio || 1, 2)
    w = Math.round(r.width); h = Math.round(r.height)
    canvas.width = w * dpr; canvas.height = h * dpr
    const m = (getComputedStyle(banner).getPropertyValue('--accent-on').trim() || '#ffffff').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    rgb = m ? [m[1], m[2], m[3]].map((x) => parseInt(x, 16)) : [255, 255, 255]
  }
  const S = () => Math.min(w, h * 1.6)
  const pos = (b) => [w * (b.bx + b.ax * Math.sin(t * b.sp + b.ph)), h * (b.by + b.ay * Math.cos(t * b.sp * 0.8 + b.ph * 1.3)), (b.r * S()) ** 2]
  const field = (x, y, P) => { let f = 0; for (const [bx, by, r2] of P) { const dx = x - bx, dy = y - by; f += r2 / (dx * dx + dy * dy + 1) } return f }
  function draw() {
    if (!w || !h) return
    const P = blobs.map(pos)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.font = '500 8px "JetBrains Mono", ui-monospace, monospace'
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center'
    for (let y = cell / 2; y < h; y += cell) for (let x = cell / 2; x < w; x += cell) {
      const f = field(x, y, P)
      if (f < 0.6) continue
      const v = Math.min(1, (f - 0.6) / 2.6)
      ctx.fillStyle = `rgba(${rgb.join(',')},${(0.35 + v * 0.6).toFixed(3)})`
      ctx.fillText(GLYPHS[1 + Math.min(GLYPHS.length - 2, Math.floor(Math.sqrt(v) * (GLYPHS.length - 1)))], x, y)
    }
  }
  function loop(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    speed += (target - speed) * Math.min(1, dt * 4)
    t += dt * speed
    draw()
    if (target > 0 || speed > 0.01) raf = requestAnimationFrame(loop)
    else { raf = 0; last = 0 }
  }
  const go = (on) => { if (reduceMotion) return; target = on ? 1 : 0; if (!raf) { last = 0; raf = requestAnimationFrame(loop) } }
  banner.addEventListener('mouseenter', () => go(true))
  banner.addEventListener('mouseleave', () => go(false))
  banner.addEventListener('focus', () => go(true))
  banner.addEventListener('blur', () => go(false))
  const observer = new ResizeObserver(() => { size(); draw() })
  observer.observe(art)
  document.fonts.ready.then(() => { if (canvas.isConnected) draw() })
  return () => { observer.disconnect(); cancelAnimationFrame(raf) }
}

// ---------- 查看作品 ----------
// 在页面里打开，不开新窗口：桌面版里 iframe 的新窗口链接会交给系统浏览器，那边没有 dsh 的登录，打不开。
// 原链接留着，中键 / Cmd+点击仍然在新标签页打开（网页版）
const viewer = document.getElementById('viewer')
async function openProjectWork(work, resume) {
  const target = work.taskRef || work.sessionId
  try {
    return await (resume ? ma.tasks.open(target) : ma.tasks.preview(target, work.relativePath))
  } catch (error) {
    if (work.taskRef || !String(error).includes('TASK_SESSION_MISSING')) throw error
  }
  if (!await ma.ui.confirm({ title: local('重新关联作品？', 'Reconnect this work?'),
    detail: local('原会话已不可用。使用当前项目中的这个文件继续？', 'The original session is unavailable. Use this file in the current project?') + '\n' + work.relativePath,
    confirmLabel: local('打开并关联', 'Open and reconnect') })) return
  const { sessionId } = await ma.agent.open()
  await ma.tasks.preview(sessionId, work.relativePath)
  await ma.agent.domain.command('work.relink', { id: work.id, previousSessionId: work.sessionId })
  if (resume) await ma.tasks.open(sessionId)
}
async function openViewer(w) {
  if (w.relativePath) return openProjectWork(w, false)
  if (w.kind === 'html') {
    const html = w.example ? (await ma.agent.domain.query('example.html', {id:w.id,lang:i18n.lang})).html : (await ma.agent.domain.query('work.read', { id: w.id })).html
    const exported = await ma.exports.create([{ name: 'index.html', text: html }], w.title)
    const result = await ma.exports.preview(exported.exportId, 'index.html')
    if (!result.ok) throw new Error(result.error)
    return
  }
  viewer.querySelector('.viewer-title').textContent = w.title
  const body = viewer.querySelector('.viewer-body')
  body.className = 'viewer-body images'
  body.innerHTML = w.files.map(f => `<img src="${esc(f)}" alt="">`).join('')
  viewer.hidden = false
  viewer.querySelector('[data-viewer="close"]').focus()
}
function closeViewer() {
  if (document.fullscreenElement) document.exitFullscreen()
  viewer.hidden = true
  viewer.querySelector('.viewer-body').innerHTML = ''
}
viewer.querySelector('[data-viewer="full"]').hidden = !document.fullscreenEnabled
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !viewer.hidden && !document.fullscreenElement) closeViewer() })

// ---------- 交互 ----------
async function handleClick(e) {
  const a = e.target.closest('a[data-open]')
  if (a && data && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
    e.preventDefault()
    await openViewer([...data.works, ...data.examples].find((w) => w.id === a.dataset.open))
    return
  }
  const b = e.target.closest('button')
  if (b?.dataset.viewer === 'close') return closeViewer()
  if (b?.dataset.viewer === 'full') return viewer.requestFullscreen().catch(() => toast(t('viewer.noFull')))
  if (!b || !data) return
  if (b.id === 'import-images') return importImages()
  if (b.dataset.resume) return openProjectWork(data.works.find(w => w.id === b.dataset.resume), true)
  if (b.dataset.starter) return start(data.skills.find((s) => s.name === b.dataset.starter).starter)
  else if (b.dataset.recipe) return start(data.recipes.find((r) => r.id === b.dataset.recipe).prompt, data.recipes.find((r) => r.id === b.dataset.recipe).title)
  else if (b.dataset.next) return start([...data.works, ...data.examples].find((w) => w.id === b.dataset.next).next)
  else if (b.dataset.column) return start(data.columns.find((c) => c.name === b.dataset.column).next)
  else if (b.dataset.voice) return start(data.voice.prompts[b.dataset.voice])
  else if (b.dataset.seg) { state[b.dataset.seg] = b.dataset.skill; render() }
  else if (b.dataset.remove) {
    const w = data.works.find((x) => x.id === b.dataset.remove)
    if (!w || b.disabled) return
    b.disabled = true
    try {
      if (!await ma.ui.confirm({ title: local('移出作品？', 'Remove work?'), detail: local('从作品库移出「' + w.title + '」，项目文件会保留。', 'Remove “' + w.title + '” from the library? Project files will be kept.'), confirmLabel: local('移出', 'Remove'), danger: true })) return
      const r = await ma.agent.domain.command('work.remove', { id: w.id })
      if (r.ok) { toast(t('work.removed')); await load() }
    } finally { b.disabled = false }
  }
}
document.addEventListener('click', e => handleClick(e).catch(error => toast(error.message)))
document.addEventListener('input', (e) => {
  if (e.target.id !== 'q' || e.isComposing) return
  state.q = e.target.value
  const results = $('#work-results')
  results.innerHTML = workResults()
  observePreviews(results)
})
addEventListener('hashchange', () => { render(); scrollTo(0, 0) })

async function importImages() {
  const paths = await ma.files.pick()
  if (!paths.length) return
  const images = []
  try {
    for (const file of paths) {
      const ext = file.split('.').pop().toLowerCase()
      if (!['png','jpg','jpeg','webp','gif'].includes(ext)) throw new Error(local('请选择图片文件', 'Please select image files'))
      const asset = await ma.media.import(file, 'image.' + ext, 'image/' + (ext === 'jpg' ? 'jpeg' : ext))
      images.push(asset.assetId)
      await ma.media.retain(asset.assetId)
    }
    await ma.agent.domain.command('work.save', {id: crypto.randomUUID(), title: paths[0].split(/[\\/]/).pop(), skill: 'guizang-social-card-skill', images})
  } catch (error) {
    await Promise.allSettled(images.map(id => ma.media.release(id)))
    throw error
  }
  await load()
}
let revision = 0
async function load() {
  const current = ++revision
  await ma.ready
  const lang = i18n.lang
  const catalog = await ma.agent.domain.query('catalog', {lang})
  const works = await Promise.all(catalog.works.map(async work => {
    const files = await Promise.all((work.images || []).map(id => ma.media.url(id).then(asset => asset.url).catch(() => null)))
    return {...work, files:files.filter(Boolean), missing:files.includes(null)}
  }))
  if (current !== revision) return
  data = {...catalog, works}
  render()
}
function refresh() { load().catch(error => { toast(error.message); if (!data) $('#app').textContent = error.message }) }
ma.ready.then(ctx => {
  function appearance() {
    const settings = ma.context()?.appearance || ctx.appearance || {}
    if (i18n.set(settings.locale)) refresh()
  }
  appearance()
  new MutationObserver(appearance).observe(document.documentElement, { attributes:true, attributeFilter:['lang','data-theme'] })
  ma.on('state.changed', refresh)
  refresh()
}).catch(error => { $('#app').textContent = error.message })
