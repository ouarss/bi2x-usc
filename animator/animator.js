// bi2x animator: three editors (strips, lamps, reader) over one SVG cabinet,
// on a video-style timeline, saved as the shim's .json files.

const NZONES = 10
const MAX_STOPS = 8
const OFF = '#10181f'
const SVGNS = 'http://www.w3.org/2000/svg'
const BTN_ORDER = ['S', 'A', 'B', 'C', 'D', 'L', 'R']
const BTN_IDS = { S: 'bS', A: 'bA', B: 'bB', C: 'bC', D: 'bD', L: 'bL', R: 'bR' }
const INI_KEY = { strips: 'pattern_title', lamps: 'btn_anim_title', reader: 'reader_title' }

const $ = (id) => document.getElementById(id)

// A strips keyframe is an array of 10 zones, each an array of stops {c, p}
// (a hex colour and its position 0..100 across the zone's LEDs, kept sorted;
// one stop = solid). The keyframe array also carries a `.b` (0..100), the
// whole-strip brightness for that frame. lamps: button tokens. reader: a hex.
const makeStrips = (colour) => {
  const a = Array.from({ length: 10 }, () => [{ c: colour, p: 0 }])
  a.b = 100
  return a
}
const state = {
  type: 'strips',
  steps: {
    strips: [makeStrips('#00ddff'), makeStrips('#0b1117')],
    lamps: [['S'], ['A'], ['B'], ['C'], ['D'], ['L'], ['R']],
    reader: ['#00ddff', '#0b1117'],
  },
  sel: 0,
  kfSel: false,        // a keyframe was explicitly picked (shows its actions)
  zone: null,          // selected zone, strips only
  selStop: 0,          // selected stop within the zone
  playing: null,
}

const steps = () => state.steps[state.type]
const stepMs = () => Math.max(20, Number($('stepms').value) || 250)
const blank = () => state.type === 'strips'
  ? makeStrips('#0b1117')
  : state.type === 'lamps' ? [] : '#0b1117'
// Deep-copy a step of the current type (arrays keep the .b brightness prop,
// which JSON would drop).
const cloneStep = (step) => {
  if (state.type === 'strips') {
    const c = step.map((zone) => zone.map((s) => ({ c: s.c, p: s.p })))
    c.b = step.b
    return c
  }
  return state.type === 'lamps' ? step.slice() : step
}

// ------------------------------------------------------------------- colours

const chans = (hex) => {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const lerpRgb = (a, b, w) => {
  const [r1, g1, b1] = chans(a), [r2, g2, b2] = chans(b)
  const m = (x, y) => Math.round(x + (y - x) * w)
  return `rgb(${m(r1, r2)},${m(g1, g2)},${m(b1, b2)})`
}
const lerpHex = (a, b, w) => {
  const [r1, g1, b1] = chans(a), [r2, g2, b2] = chans(b)
  const h = (x, y) => ('0' + Math.round(x + (y - x) * w).toString(16)).slice(-2)
  return '#' + h(r1, r2) + h(g1, g2) + h(b1, b2)
}
// A stop's colour scaled by its brightness (0..100), what actually shows.
const scaledHex = (c, b) => {
  const [r, g, bl] = chans(c)
  const f = (b === undefined ? 100 : b) / 100
  const h = (v) => ('0' + Math.round(v * f).toString(16)).slice(-2)
  return '#' + h(r) + h(g) + h(bl)
}

// The gradient colour at position p (0..100), for a new stop.
const sampleAt = (stops, p) => {
  if (p <= stops[0].p) return stops[0].c
  const last = stops[stops.length - 1]
  if (p >= last.p) return last.c
  for (let k = 0; k < stops.length - 1; k++) {
    if (p <= stops[k + 1].p) {
      const span = stops[k + 1].p - stops[k].p || 1
      return lerpHex(stops[k].c, stops[k + 1].c, (p - stops[k].p) / span)
    }
  }
  return last.c
}

// ------------------------------------------------------------------- painting

const setGradient = (z, stops) => {
  const g = $('gz' + z)
  while (g.firstChild) g.removeChild(g.firstChild)
  stops.forEach((s) => {
    const stop = document.createElementNS(SVGNS, 'stop')
    stop.setAttribute('offset', s.p + '%')
    stop.setAttribute('stop-color', s.c)
    g.appendChild(stop)
  })
}

const paint = (index, w = 0) => {
  const list = steps()
  const i = ((index % list.length) + list.length) % list.length
  const j = (i + 1) % list.length
  const fade = $('fade').checked && state.type !== 'lamps' ? w : 0
  for (let z = 0; z < NZONES; z++) {
    const el = $('z' + z)
    if (state.type === 'strips') {
      const si = list[i][z], sj = list[j][z]
      const bA = list[i].b, bB = list[j].b   // whole-strip brightness per frame
      const n = si.length
      const blend = fade > 0 && sj.length === n
      const eff = si.map((s, k) => {
        const ci = scaledHex(s.c, bA)
        if (!blend) return { c: ci, p: s.p }
        return { c: lerpRgb(ci, scaledHex(sj[k].c, bB), fade),
                 p: s.p + (sj[k].p - s.p) * fade }
      })
      if (n === 1) {
        el.style.fill = eff[0].c
      } else {
        setGradient(z, eff)
        el.style.fill = `url(#gz${z})`
      }
    } else {
      el.style.fill = OFF
    }
  }
  for (const t of BTN_ORDER) {
    $(BTN_IDS[t]).classList.toggle('on', state.type === 'lamps' && list[i].includes(t))
  }
  $('zR').style.fill = state.type === 'reader' ? lerpRgb(list[i], list[j], fade) : OFF
}

const paintSel = () => { if (!state.playing) paint(state.sel) }

// -------------------------------------------------------------- the timeline

const PAD = 0.03
const place = (frac) => (PAD + frac * (1 - 2 * PAD)) * 100
const cursorAt = (frac) => {
  $('tl-cursor').style.left = place(frac) + '%'
  $('tl-fill').style.width = place(frac) + '%'
}

const renderTimeline = () => {
  const list = steps()
  // a reader keyframe carries one colour: show it on its diamond
  $('tl-points').innerHTML = list.map((_, i) => {
    const tint = state.type === 'reader' ? `background:${list[i]};` : ''
    return `<div class="tl-point${i === state.sel && state.kfSel ? ' choisi' : ''}" data-i="${i}"
          style="left:${place(i / list.length)}%;${tint}"><span class="idx">${i + 1}</span></div>`
  }).join('')
  // a + between keyframes and after the last, to insert one there
  $('tl-adds').innerHTML = list.length >= 256 ? '' : list.map((_, i) =>
    `<div class="tl-add" data-i="${i + 1}" style="left:${place((i + 0.5) / list.length)}%">+</div>`).join('')
  if (!state.playing) { paint(state.sel); cursorAt(state.sel / list.length) }
  $('temps').textContent =
    `${list.length} keyframes · loop ${((list.length * stepMs()) / 1000).toFixed(2)} s`
  // the keyframe's actions only show once one is explicitly picked; strips get
  // the brightness slider, reader its one colour, right under the diamond
  const kfa = $('kf-actions')
  kfa.hidden = !state.kfSel
  $('kf-bri').hidden = state.type !== 'strips'
  $('couleur-reader').hidden = state.type !== 'reader'
  $('reader-hex').hidden = state.type !== 'reader'
  if (state.type === 'strips') $('kf-bri').value = list[state.sel].b
  if (state.type === 'reader') {
    $('couleur-reader').value = list[state.sel]
    $('reader-hex').value = list[state.sel]
  }
  if (state.kfSel) {
    // clamp so the box stays inside the timeline even at the first/last frame
    const wrap = $('tlwrap')
    const half = kfa.offsetWidth / 2
    const px = place(state.sel / list.length) / 100 * wrap.clientWidth
    kfa.style.left = Math.max(half, Math.min(wrap.clientWidth - half, px)) + 'px'
  }
  $('zone-note').textContent = state.zone === null
    ? 'none selected — click a zone on the cabinet' : `z${state.zone} selected`
  document.querySelectorAll('.zone').forEach((el) => el.classList.remove('choisie'))
  if (state.type === 'strips' && state.zone !== null) $('z' + state.zone).classList.add('choisie')
  if (state.type === 'reader') $('zR').classList.add('choisie')
}

const fracOf = (clientX) => {
  const r = $('timeline').getBoundingClientRect()
  const raw = (clientX - r.left) / r.width
  return Math.max(0, Math.min(0.9999, (raw - PAD) / (1 - 2 * PAD)))
}

let dragKf = null
$('timeline').addEventListener('pointerdown', (e) => {
  stop()
  const point = e.target.closest('.tl-point')
  const n = steps().length
  if (point) {
    dragKf = Number(point.dataset.i)
    state.sel = dragKf
    $('timeline').setPointerCapture(e.pointerId)
  } else {
    const f = fracOf(e.clientX)
    const i = Math.floor(f * n)
    paint(i, f * n - i)
    cursorAt(f)
    state.sel = i % n
  }
  state.kfSel = true
  renderTimeline()
  renderTools()
})
$('timeline').addEventListener('pointermove', (e) => {
  if (dragKf === null) return
  const n = steps().length
  const target = Math.max(0, Math.min(n - 1, Math.round(fracOf(e.clientX) * n)))
  if (target !== dragKf) {
    const [kf] = steps().splice(dragKf, 1)
    steps().splice(target, 0, kf)
    dragKf = target
    state.sel = target
    renderTimeline()
    renderTools()
  }
})
const endDrag = () => { dragKf = null }
$('timeline').addEventListener('pointerup', endDrag)
$('timeline').addEventListener('pointercancel', endDrag)

$('tl-points').addEventListener('dblclick', (e) => {
  const point = e.target.closest('.tl-point')
  if (!point || steps().length >= 256) return
  const i = Number(point.dataset.i)
  steps().splice(i + 1, 0, cloneStep(steps()[i]))
  state.sel = i + 1
  state.kfSel = true
  renderTimeline()
  renderTools()
})

// ------------------------------------------------------------------ the tabs

const setType = (type) => {
  stop()
  state.type = type
  state.sel = 0
  state.kfSel = false
  state.zone = null
  state.selStop = 0
  document.querySelectorAll('.onglets button').forEach((b) =>
    b.classList.toggle('actif', b.dataset.type === type))
  $('outils-strips').hidden = type !== 'strips'
  $('outils-reader').hidden = type !== 'reader'
  $('outils-lamps').hidden = type !== 'lamps'
  $('fade-boite').style.visibility = type === 'lamps' ? 'hidden' : 'visible'
  renderTimeline()
  renderTools()
}

document.querySelectorAll('.onglets button').forEach((b) =>
  b.addEventListener('click', () => setType(b.dataset.type)))

// ------------------------------------------------------------ keyframe edits

// Insert a blank keyframe at index idx (from the timeline + markers).
const insertAt = (idx) => {
  if (steps().length >= 256) return
  steps().splice(idx, 0, blank())
  state.sel = idx
  state.kfSel = true
  renderTimeline()
  renderTools()
}
$('tl-adds').addEventListener('pointerdown', (e) => {
  const a = e.target.closest('.tl-add')
  if (!a) return
  e.stopPropagation()
  insertAt(Number(a.dataset.i))
})
$('dupliquer').addEventListener('click', () => {
  if (steps().length >= 256) return
  steps().splice(state.sel + 1, 0, cloneStep(steps()[state.sel]))
  state.sel++
  renderTimeline()
  renderTools()
})
$('supprimer').addEventListener('click', () => {
  if (steps().length <= 1) return
  steps().splice(state.sel, 1)
  state.sel = Math.min(state.sel, steps().length - 1)
  renderTimeline()
  renderTools()
})

// -------------------------------------------------- the zone gradient editor

// Rebuild the tool inputs (only on structural changes, so editing a colour
// does not tear down the open native picker).
const renderTools = () => {
  const bar = $('gradbar')
  const edit = $('stopedit')
  const zoned = state.type === 'strips' && state.zone !== null
  if (zoned) {
    const zone = steps()[state.sel][state.zone]
    if (state.selStop >= zone.length) state.selStop = zone.length - 1
    paintBar()
    bar.innerHTML = zone.map((s, k) =>
      `<div class="handle${k === state.selStop ? ' sel' : ''}" data-k="${k}" style="left:${s.p}%"></div>`).join('')
    edit.hidden = false
    $('stopcol').value = zone[state.selStop].c
    $('stophex').value = zone[state.selStop].c
    // Hang the editor under the stop, but clamp so its box never leaves the
    // bar (a stop near either end would push it off-screen otherwise).
    const wrap = $('gradwrap')
    const half = edit.offsetWidth / 2
    const px = zone[state.selStop].p / 100 * wrap.clientWidth
    edit.style.left = Math.max(half, Math.min(wrap.clientWidth - half, px)) + 'px'
  } else {
    bar.style.background = ''
    bar.innerHTML = ''
    edit.hidden = true
  }
  $('zone-toutes').hidden = !zoned
}

// Repaint only the editor's gradient bar (its background), keeping the picker
// open during a live edit.
const paintBar = () => {
  if (state.zone === null) return
  const zone = steps()[state.sel][state.zone]
  $('gradbar').style.background = zone.length === 1 ? zone[0].c
    : `linear-gradient(90deg, ${zone.map((s) => `${s.c} ${s.p}%`).join(', ')})`
}

for (let z = 0; z < NZONES; z++) {
  $('z' + z).addEventListener('click', () => {
    if (state.type !== 'strips') return
    state.zone = z
    state.selStop = 0
    renderTimeline()
    renderTools()
  })
}
for (const t of BTN_ORDER) {
  $(BTN_IDS[t]).addEventListener('click', () => {
    if (state.type !== 'lamps') return
    const list = steps()[state.sel]
    const at = list.indexOf(t)
    if (at >= 0) list.splice(at, 1); else list.push(t)
    renderTimeline()
  })
}

const barPos = (clientX) => {
  const r = $('gradbar').getBoundingClientRect()
  return Math.max(0, Math.min(100, Math.round((clientX - r.left) / r.width * 100)))
}

let dragStop = null
$('gradbar').addEventListener('pointerdown', (e) => {
  if (state.zone === null) return
  const zone = steps()[state.sel][state.zone]
  const h = e.target.closest('.handle')
  if (h) {
    state.selStop = Number(h.dataset.k)
  } else {
    if (zone.length >= MAX_STOPS) return
    const p = barPos(e.clientX)
    const ns = { c: sampleAt(zone, p), p }
    zone.push(ns)
    zone.sort((a, b) => a.p - b.p)
    state.selStop = zone.indexOf(ns)
  }
  dragStop = zone[state.selStop]
  $('gradbar').setPointerCapture(e.pointerId)
  renderTools()
  paintSel()
})
$('gradbar').addEventListener('pointermove', (e) => {
  if (dragStop === null) return
  const zone = steps()[state.sel][state.zone]
  dragStop.p = barPos(e.clientX)
  zone.sort((a, b) => a.p - b.p)
  state.selStop = zone.indexOf(dragStop)
  renderTools()
  paintSel()
})
const endStop = () => { dragStop = null }
$('gradbar').addEventListener('pointerup', endStop)
$('gradbar').addEventListener('pointercancel', endStop)

// The native picker opens on RGB and its mode is not ours to set, so a hex
// field sits beside every swatch, synced both ways, for hex by default.
const applyStopColour = (hex) => {
  if (state.zone === null) return
  steps()[state.sel][state.zone][state.selStop].c = hex
  paintBar()
  paintSel()
}
$('stopcol').addEventListener('input', () => {
  $('stophex').value = $('stopcol').value
  applyStopColour($('stopcol').value)
})
$('stophex').addEventListener('input', () => {
  const v = $('stophex').value.trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(v)) return
  $('stopcol').value = v
  applyStopColour(v)
})
$('kf-bri').addEventListener('input', () => {
  if (state.type !== 'strips') return
  steps()[state.sel].b = Number($('kf-bri').value)
  paintSel()
})
$('stopdel').addEventListener('click', () => {
  if (state.zone === null) return
  const zone = steps()[state.sel][state.zone]
  if (zone.length <= 1) return
  zone.splice(state.selStop, 1)
  state.selStop = Math.min(state.selStop, zone.length - 1)
  renderTimeline()
  renderTools()
})
$('zone-toutes').addEventListener('click', () => {
  if (state.type !== 'strips' || state.zone === null) return
  const zone = steps()[state.sel][state.zone]
  for (let z = 0; z < NZONES; z++)
    steps()[state.sel][z] = zone.map((s) => ({ c: s.c, p: s.p }))
  renderTimeline()
})

const applyReaderColour = (hex) => {
  if (state.type !== 'reader') return
  steps()[state.sel] = hex
  renderTimeline()
}
$('couleur-reader').addEventListener('input', () => {
  $('reader-hex').value = $('couleur-reader').value
  applyReaderColour($('couleur-reader').value)
})
$('reader-hex').addEventListener('input', () => {
  const v = $('reader-hex').value.trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(v)) return
  $('couleur-reader').value = v
  applyReaderColour(v)
})

$('nom').addEventListener('input', () => {
  const el = $('nom')
  const clean = sanitizeName(el.value)
  if (clean !== el.value) {
    const removed = el.value.length - clean.length
    const pos = Math.max(0, (el.selectionStart || 0) - removed)
    el.value = clean
    el.setSelectionRange(pos, pos)
  }
  renderTimeline()
})
$('stepms').addEventListener('input', () => { if (!state.playing) renderTimeline() })


// ------------------------------------------------------------------ playback

const stop = () => {
  if (state.playing) cancelAnimationFrame(state.playing)
  state.playing = null
  $('jouer').innerHTML = '&#9654; play'
}

const startPlayback = () => {
  if (state.playing) return
  $('jouer').innerHTML = '&#9632; stop'
  const start = performance.now()
  const tick = (now) => {
    const n = steps().length
    const loop = n * stepMs()
    const frac = ((now - start) % loop) / loop
    const i = Math.floor(frac * n)
    paint(i, frac * n - i)
    cursorAt(frac)
    state.playing = requestAnimationFrame(tick)
  }
  state.playing = requestAnimationFrame(tick)
}

$('jouer').addEventListener('click', () => {
  if (state.playing) { stop(); renderTimeline(); return }
  startPlayback()
})

// -------------------------------------------------------------- save / load

const zoneToken = (stops) => stops.length === 1
  ? stops[0].c
  : stops.map((s) => `${s.c}@${Math.round(s.p)}`).join('-')

// The editor's current content as the shim's .json text, the exact shape the
// game loads: step_ms, the steps as strings, fade, and bright when it varies.
const buildFileText = () => {
  const out = { step_ms: stepMs() }
  if (state.type !== 'lamps') out.fade = $('fade').checked
  out.steps = state.type === 'strips'
    ? steps().map((s) => s.map(zoneToken).join(' '))
    : state.type === 'lamps'
      ? steps().map((s) => s.join(' '))
      : steps().slice()
  if (state.type === 'strips') {
    const bright = steps().map((st) => st.b)
    if (bright.some((b) => b !== 100)) out.bright = bright
  }
  return JSON.stringify(out, null, 2) + '\n'
}

// The name becomes a filename and an ini value: keep it to a-z A-Z 0-9 - _.
const sanitizeName = (s) => (s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
const cleanName = () => sanitizeName($('nom').value) || 'myanim'

// Save writes into the chosen local folder when there is one, else it falls
// back to a browser download. The site is static: no server ever writes a file.
const downloadFile = (name, text) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}
// The message after a save, with the exact line to paste in bi2x.ini.
const showSaved = (msg, name) => {
  $('resultat').innerHTML = `${msg}<br><span class="note">bi2x.ini:</span> ` +
    `<code>${INI_KEY[state.type]} = ${name}</code>`
}
$('sauver').addEventListener('click', async () => {
  stop()
  const name = cleanName()
  $('nom').value = name
  const text = buildFileText()
  if (dirHandle && await ensureWrite(dirHandle)) {
    try {
      const fh = await dirHandle.getFileHandle(name + '.json', { create: true })
      const w = await fh.createWritable()
      await w.write(text)
      await w.close()
      showSaved(`saved ${name}.json to your folder`, name)
      listPerso()
      return
    } catch { $('resultat').textContent = 'could not write to the folder' }
  }
  downloadFile(name + '.json', text)
  showSaved(`downloaded ${name}.json`, name)
})

// Which editor a file belongs to, from its first step (ported from the server).
const sniff = (data) => {
  const first = data && data.steps && data.steps[0]
  if (typeof first !== 'string') return null
  const words = first.split(/\s+/).filter(Boolean)
  if (words.length === 10 && words.every((w) => w.startsWith('#'))) return 'strips'
  if (words.length === 1 && words[0].startsWith('#')) return 'reader'
  if (words.length === 3 && words.every((w) => /^\d+$/.test(w))) return 'reader'
  return 'lamps'
}

// A reader step may be saved as "r g b"; the editor keeps colours in hex, so
// the swatch and the timeline show them and the picker can read them back.
const readerToHex = (step) => {
  if (typeof step !== 'string') return '#000000'
  if (step.trim().startsWith('#')) return step.trim().toLowerCase()
  const [r, g, b] = step.trim().split(/\s+/).map(Number)
  return '#' + [r, g, b].map((v) => ('0' + ((v | 0) & 255).toString(16)).slice(-2)).join('')
}

// Load a .json File object (from the disk picker or a drop) into the editor.
const loadFile = async (file) => {
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    const type = sniff(data)
    if (!type) throw new Error('shape')
    applyLoaded(file.name.replace(/\.json$/i, ''), type, data)
    closeModal()
    $('resultat').textContent = `opened ${file.name}`
  } catch { $('resultat').textContent = 'not a valid animation file' }
}
$('fichier').addEventListener('change', () => {
  loadFile($('fichier').files[0])
  $('fichier').value = ''
})

// A local folder as a second source (File System Access API, Chrome / Edge).
let dirHandle = null
let persoAnims = []
const fsSupported = 'showDirectoryPicker' in window

const ensureWrite = async (handle) => {
  const opts = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

// Read every .json in the linked folder, with its kind, for the popup list.
const listPerso = async () => {
  if (!dirHandle) return
  const found = []
  try {
    for await (const [entry, handle] of dirHandle.entries()) {
      if (handle.kind !== 'file' || !entry.toLowerCase().endsWith('.json')) continue
      try {
        const data = JSON.parse(await (await handle.getFile()).text())
        const type = sniff(data)
        if (type) found.push({ name: entry.replace(/\.json$/i, ''), type })
      } catch { /* skip a bad file */ }
    }
  } catch { $('resultat').textContent = 'could not read the folder'; return }
  persoAnims = found.sort((a, b) => a.name.localeCompare(b.name))
}

const parseZone = (token) => {
  const parts = token.split('-')
  return parts.map((t, k) => {
    const [c, at] = t.split('@')
    const p = at !== undefined ? Number(at) : (parts.length > 1 ? Math.round(k / (parts.length - 1) * 100) : 0)
    return { c, p }
  }).sort((a, b) => a.p - b.p)
}

// Load a parsed animation into the editor, whatever its source.
const applyLoaded = (name, type, data) => {
  setType(type)
  $('nom').value = sanitizeName(name)
  $('stepms').value = data.step_ms ?? 250
  $('fade').checked = data.fade !== false
  state.steps[type] = data.steps.map((s, i) => {
    if (type === 'strips') {
      const kf = s.split(/\s+/).map(parseZone)
      kf.b = Array.isArray(data.bright) && data.bright[i] !== undefined ? data.bright[i] : 100
      return kf
    }
    if (type === 'lamps') {
      return s.split(/\s+/).filter(Boolean).map((w) => {
        const u = w.toUpperCase()
        return { START: 'S', 'BT-A': 'A', 'BT-B': 'B', 'BT-C': 'C', 'BT-D': 'D',
                 'FX-L': 'L', 'FX-R': 'R' }[u] || u
      }).filter((w) => BTN_ORDER.includes(w))
    }
    return readerToHex(s)
  })
  state.sel = 0
  state.kfSel = false
  state.zone = null
  state.selStop = 0
  renderTimeline()
  renderTools()
}

// The popup lists every openable animation, grouped by kind, the bundled
// examples plus a linked folder's .json. Click to load; the ▶ loads and plays.
// The "examples" checkbox hides the bundled ones to see only your folder.
const MODAL_GROUPS = [['strips', 'Strips'], ['lamps', 'Buttons'], ['reader', 'Reader']]
const animItem = (a) =>
  `<div class="anim-item">
     <button class="anim-open" data-src="${a.src}" data-name="${a.name}">
       <span class="anim-nom">${a.name}</span>
       <span class="anim-src">${a.src}</span>
     </button>
     <button class="anim-play" data-src="${a.src}" data-name="${a.name}" title="open and play">&#9654;</button>
   </div>`
const renderModalList = () => {
  let items = (window.EXAMPLES || []).map(
    (e) => ({ name: e.name, type: e.type, src: 'example' }))
    .concat(persoAnims.map((a) => ({ name: a.name, type: a.type, src: 'folder' })))
  if (!$('filtre-example').checked) items = items.filter((i) => i.src !== 'example')
  const html = MODAL_GROUPS.map(([type, label]) => {
    const group = items.filter((i) => i.type === type)
    return group.length
      ? `<div class="modal-groupe">${label}</div>` + group.map(animItem).join('')
      : ''
  }).join('')
  $('modal-liste').innerHTML = html ||
    '<span class="note">No animations here. Link a folder or load a .json.</span>'
}

const findAnim = async (src, name) => {
  if (src === 'example') {
    const e = (window.EXAMPLES || []).find((x) => x.name === name)
    return e ? { type: e.type, data: e.data } : null
  }
  if (src === 'folder' && dirHandle) {
    try {
      const fh = await dirHandle.getFileHandle(name + '.json')
      const data = JSON.parse(await (await fh.getFile()).text())
      return { type: sniff(data) || state.type, data }
    } catch { return null }
  }
  return null
}

const openAnim = async (src, name, play) => {
  const a = await findAnim(src, name)
  if (!a) { $('resultat').textContent = 'load failed'; return }
  applyLoaded(name, a.type, a.data)
  closeModal()
  if (play) startPlayback()
  $('resultat').textContent = `opened ${name}`
}

const openModal = () => { renderModalList(); $('modal').hidden = false }
const closeModal = () => { $('modal').hidden = true }

$('ouvrir-popup').addEventListener('click', openModal)

// The open button is also a drop zone: dropping a .json loads it at once. The
// document-level guards stop the browser from opening a file dropped elsewhere.
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())
const dropBtn = $('ouvrir-popup')
;['dragenter', 'dragover'].forEach((ev) =>
  dropBtn.addEventListener(ev, () => dropBtn.classList.add('drop-actif')))
;['dragleave', 'drop'].forEach((ev) =>
  dropBtn.addEventListener(ev, () => dropBtn.classList.remove('drop-actif')))
dropBtn.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files[0]
  if (f) loadFile(f)
})

$('filtre-example').addEventListener('change', renderModalList)
$('modal-fermer').addEventListener('click', closeModal)
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal() })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal() })
$('modal-liste').addEventListener('click', (e) => {
  const btn = e.target.closest('.anim-open, .anim-play')
  if (!btn) return
  stop()
  openAnim(btn.dataset.src, btn.dataset.name, btn.classList.contains('anim-play'))
})
$('modal-fichier-btn').addEventListener('click', () => $('fichier').click())
if (fsSupported) {
  $('modal-dossier-btn').addEventListener('click', async () => {
    try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }) } catch { return }
    $('sauver').textContent = 'save to folder'
    await listPerso()
    renderModalList()
    $('resultat').textContent = `folder "${dirHandle.name}" linked`
  })
} else {
  $('modal-dossier-btn').hidden = true
}

// One linear gradient per zone: horizontal along the title and the conpane,
// vertical elsewhere; its stops are filled at paint time.
const defs = document.querySelector('#cab defs')
for (let z = 0; z < NZONES; z++) {
  const horizontal = z === 0 || z === 5
  const g = document.createElementNS(SVGNS, 'linearGradient')
  g.id = 'gz' + z
  g.setAttribute('x1', '0'); g.setAttribute('y1', '0')
  g.setAttribute('x2', horizontal ? '1' : '0')
  g.setAttribute('y2', horizontal ? '0' : '1')
  defs.appendChild(g)
}

// ------------------------------------------------------------------- start

setType('strips')
