/**
 * Draws every image used by the profile README, in a light and a dark version.
 *
 *   pnpm install && pnpm generate   # SVGs, plus the game tiles (needs rsvg-convert, ffmpeg, cwebp)
 *
 * Text is outlined: GitHub serves README images without web fonts.
 * Edit this file, never the output in ../assets.
 */
import * as fontkit from "fontkit"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { siDiscord, siX } from "simple-icons"
import { iconShapes, wordmarkBox, wordmarkDot, wordmarkLetterShapes } from "./sources/ritmo/generate.mjs"
import { pose, timing } from "./sources/ritmo/motion-model.mjs"

const here = import.meta.dirname
const out = join(here, "../assets")
const require = createRequire(import.meta.url)
mkdirSync(out, { recursive: true })

// ---------------------------------------------------------------- tokens

const FULL = 844
const HALF = FULL / 2
const THIRD = 281
const PAD = 5 // transparent margin baked into every card, so the README needs no spacing
const RADIUS = 14

const themes = {
  dark: {
    surface: "#16181d", line: "#2b2f37", strong: "#3c414b", raised: "#242830",
    fg: "#eceef1", muted: "#a7acb5", grid: "#ffffff", gridOpacity: .06,
    tick: "#FF5A36", violet: "#9D8CFF", yellow: "#FFD23F", blue: "#98b4ff", green: "#93d3ac",
    ritmo: { bg: "#0E1013", fg: "#F3F1EC", line: "#262A31", muted: "#8A8F98" },
    games: { bg: "#111111", fg: "#ffffff", line: "#2c2c2c", muted: "#a3a3a3" }
  },
  light: {
    surface: "#ffffff", line: "#dcdee3", strong: "#c3c7cf", raised: "#f1f2f5",
    fg: "#16181d", muted: "#59606b", grid: "#000000", gridOpacity: .06,
    tick: "#FF5A36", violet: "#6A54E0", yellow: "#F5B800", blue: "#3f66d6", green: "#2f8f57",
    ritmo: { bg: "#F3F1EC", fg: "#0E1013", line: "#D9D5CC", muted: "#6b6f76" },
    games: { bg: "#f8f8f6", fg: "#111111", line: "#dededa", muted: "#5f5f5b" }
  }
}

// ------------------------------------------------------------------ text

const font = (file) => fontkit.openSync(require.resolve(file))
const fonts = {
  500: font("@fontsource/mona-sans/files/mona-sans-latin-500-normal.woff2"),
  600: font("@fontsource/mona-sans/files/mona-sans-latin-600-normal.woff2"),
  mono: font("@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2")
}
const n = (value) => String(Math.round(value * 100) / 100)

/** Outlines one line of text. Returns its markup and its width. */
const line = (string, { x = 0, y = 0, size, weight = 500, fill, tracking = 0, anchor = "start" }) => {
  const face = fonts[weight]
  const scale = size / face.unitsPerEm
  const run = face.layout(string)
  let cursor = 0
  let d = ""
  run.glyphs.forEach((glyph, index) => {
    const position = run.positions[index]
    d += glyph.path.transform(scale, 0, 0, -scale, cursor + position.xOffset * scale, 0).toSVG()
      .replace(/-?\d+\.\d+/g, (value) => n(value))
    cursor += position.xAdvance * scale + tracking * size
  })
  const left = anchor === "middle" ? x - cursor / 2 : anchor === "end" ? x - cursor : x
  return { width: cursor, svg: `<path transform="translate(${n(left)} ${n(y)})" fill="${fill}" d="${d}"/>` }
}
const text = (string, options) => line(string, options).svg
const lines = (strings, { y, leading, ...options }) =>
  strings.map((string, index) => text(string, { ...options, y: y + index * leading })).join("")

// --------------------------------------------------------------- helpers

const svg = (width, height, label, body, style = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">` +
  (style ? `<style>${style}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` : "") +
  `${body}</svg>\n`

const card = (width, height, { bg, border }) =>
  `<rect x="${PAD + .5}" y="${PAD + .5}" width="${width - PAD * 2 - 1}" height="${height - PAD * 2 - 1}" rx="${RADIUS}" fill="${bg}" stroke="${border}"/>`

const cardClip = (id, width, height) =>
  `<clipPath id="${id}"><rect x="${PAD + 1}" y="${PAD + 1}" width="${width - PAD * 2 - 2}" height="${height - PAD * 2 - 2}" rx="${RADIUS - .5}"/></clipPath>`

/** A square grid that fades out towards the left. */
const grid = (x, y, width, height, cell, theme, id) => {
  let d = ""
  for (let column = x; column <= x + width + .1; column += cell) d += `M${n(column)} ${y}v${height}`
  for (let row = y; row <= y + height + .1; row += cell) d += `M${x} ${n(row)}h${width}`
  return `<defs><linearGradient id="${id}" x1="0" x2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".55" stop-color="#fff"/></linearGradient>` +
    `<mask id="${id}m" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#${id})"/></mask></defs>` +
    `<path d="${d}" stroke="${theme.grid}" stroke-opacity="${theme.gridOpacity}" mask="url(#${id}m)"/>`
}

/** Merges each run of filled pixels into one rectangle. */
const pixels = (rows, cell) => {
  let d = ""
  rows.forEach((row, y) => {
    for (const run of row.matchAll(/#+/g)) d += `M${n(run.index * cell)} ${n(y * cell)}h${n(run[0].length * cell)}v${n(cell)}h-${n(run[0].length * cell)}z`
  })
  return d
}

const typeonce = JSON.parse(readFileSync(join(here, "sources/typeonce-pixels.json"), "utf8"))

// ------------------------------------------------------------------ hero

/** Places the effect mark (the part of the logo left of x=165) in `size` px. */
const effectPaths = [...readFileSync(join(here, "sources/effect-logo.svg"), "utf8").matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((match) => match[1])
const effectMark = effectPaths.filter((d) => parseFloat(d.slice(1)) < 165)
const smLogo = readFileSync(join(here, "sources/sm-logo.svg"), "utf8").match(/<g[\s\S]*<\/g>/)[0]

const hero = (theme) => {
  const height = 244
  const tile = 96
  const gap = 14
  const left = FULL - PAD - tile * 2 - gap
  const top = 14
  const at = (column, row) => ({ x: left + column * (tile + gap), y: top + row * (tile + gap) })
  // Each mark sits in a 96px tile, on its own brand surface.
  const marks = [
    { bg: theme.ritmo.bg, border: theme.ritmo.line, accent: theme.tick, mark: `<g transform="translate(20 20) scale(.56)">${iconShapes({ color: theme.ritmo.fg, dot: theme.tick })}</g>` },
    { bg: theme.surface, border: theme.line, accent: theme.violet, mark: `<g transform="translate(19 19) scale(.36)" fill="${theme.fg}">${effectMark.map((d) => `<path fill-rule="evenodd" d="${d}"/>`).join("")}</g>` },
    { bg: theme.games.bg, border: theme.games.line, accent: theme.yellow, mark: `<path transform="translate(24 24)" shape-rendering="crispEdges" fill="${theme.games.fg}" d="${pixels(typeonce.mark, 3)}"/>` },
    { bg: theme.surface, border: theme.line, accent: theme.blue, mark: `<g transform="translate(7 7) scale(.08008)" >${smLogo.replace(/fill="[^"]*"/, `fill="${theme.fg}"`)}</g>` }
  ]
  const tiles = marks.map(({ bg, border, accent, mark }, index) => {
    const { x, y } = at(index % 2, index >> 1)
    return `<g transform="translate(${x} ${y})"><g class="h" style="animation-delay:${200 + index * 240}ms">` +
      `<rect x=".5" y=".5" width="${tile - 1}" height="${tile - 1}" rx="${RADIUS}" fill="${bg}" stroke="${border}"/>${mark}` +
      `<rect class="o" style="animation-delay:${200 + index * 240}ms" opacity="0" width="${tile}" height="${tile}" rx="${RADIUS}" fill="${accent}"/></g></g>`
  }).join("")
  const style =
    `.h{animation:h 300ms cubic-bezier(.2,1.4,.4,1) backwards;transform-origin:${tile / 2}px ${tile / 2}px}@keyframes h{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:none}}` +
    `.o{animation:o 620ms steps(1) backwards}@keyframes o{0%{opacity:1}60%{opacity:0}100%{opacity:0}}`
  return svg(FULL, height, "I build it, then I write it all down. Type-safe software, indie games, and building with AI.",
    text("I build it,", { x: PAD, y: 78, size: 56, weight: 600, fill: theme.fg, tracking: -.022 }) +
    text("then I write it all down.", { x: PAD, y: 144, size: 56, weight: 600, fill: theme.fg, tracking: -.022 }) +
    text("Type-safe software, indie games, and building with AI", { x: PAD + 2, y: 204, size: 23, fill: theme.muted }) +
    tiles, style)
}

// ----------------------------------------------------------------- ritmo

/** Ritmo's own motion model, sampled into CSS keyframes. */
const ritmoScene = (color, dot) => {
  const cycle = 9000
  const box = wordmarkBox(false)
  const scale = 100 / box.height
  const jumper = (p) => `translate(${n(p.x)}px,${n(p.y)}px) scale(${n(p.sx)},${n(p.sy)}) translate(0px,-44px) rotate(${n(p.angle)}deg) translate(-50px,-50px)`
  const frames = []
  for (let t = 0; t <= timing.rest; t += 1000 / 40) frames.push(t)
  frames.push(timing.rest)
  const at = (t) => `${Math.round(t / cycle * 1e4) / 100}%`
  const keyframes = (name, declare) => `@keyframes ${name}{${frames.map((t) => `${at(t)}{${declare(pose(t))}}`).join("")}`
  const rest = pose(timing.duration)
  const target = { x: 130 + (wordmarkDot.x + wordmarkDot.size / 2 - box.x) * scale, y: (wordmarkDot.y + wordmarkDot.size / 2 - box.y) * scale }
  const size = wordmarkDot.size * scale
  const letters = wordmarkLetterShapes()
  return {
    style:
      `.j{transform:${jumper(rest)};animation:j ${cycle}ms linear infinite}${keyframes("j", (p) => `transform:${jumper(p)}`)}100%{transform:${jumper(rest)}}}` +
      `.r{animation:r ${cycle}ms linear infinite}${keyframes("r", (p) => `transform:translate(0px,${n(p.dip / scale)}px)`)}100%{transform:none}}` +
      `.p{animation:p ${cycle}ms linear infinite}@keyframes p{0%,${at(timing.stamp)}{opacity:0}${at(timing.stamp + 65)},97%{opacity:1}100%{opacity:0}}`,
    body:
      `<g transform="translate(130 0) scale(${n(scale)}) translate(${-box.x} ${-box.y})" fill="none" stroke="${color}" stroke-width="12"><g class="r">${letters.slice(0, 2).join("")}</g>${letters.slice(2).join("")}</g>` +
      `<rect class="p" x="${n(target.x - size / 2)}" y="${n(target.y - size / 2)}" width="${n(size)}" height="${n(size)}" rx="${n(wordmarkDot.radius * scale)}" fill="${dot}"/>` +
      `<g class="j">${iconShapes({ color, dot })}</g>`
  }
}

const ritmo = (theme) => {
  const height = 298
  const skin = theme.ritmo
  const scene = ritmoScene(skin.fg, theme.tick)
  const scale = .88
  return svg(FULL, height, "Ritmo: the all-in-one toolkit for agent-first game development",
    `<defs>${cardClip("c", FULL, height)}</defs>` + card(FULL, height, { bg: skin.bg, border: skin.line }) +
    `<g clip-path="url(#c)">${grid(PAD + 380, PAD, 454, 308, 28, theme, "g")}` +
    `<g transform="translate(${PAD + 34} ${height - PAD - 42 - 94 * scale}) scale(${scale})">${scene.body}</g></g>` +
    lines(["The all-in-one toolkit", "for agent-first", "game development"], { x: 474, y: 112, leading: 41, size: 32, weight: 600, fill: skin.fg, tracking: -.015 }) +
    text("@typeonce/ritmo", { x: 474, y: height - PAD - 46, size: 20, weight: "mono", fill: skin.muted }),
    scene.style)
}

// ---------------------------------------------------------------- effect

const effect = (theme) => {
  const height = 290
  const paths = effectPaths.map((d) => `<path fill-rule="evenodd" fill="${theme.fg}" d="${d}"/>`).join("")
  const tile = 112
  const gap = 12
  const top = 148
  const stroke = `fill="none" stroke="${theme.fg}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`
  // 48x48 glyphs, one per contributed module.
  const glyphs = {
    Trie: `<path ${stroke} d="M24 11 12 24M24 11 36 24M12 24 6 38M12 24 18 38M36 24V38"/><g fill="${theme.surface}" stroke="${theme.fg}" stroke-width="2.5"><circle cx="24" cy="10" r="4.5"/><circle cx="12" cy="24" r="4.5"/><circle cx="36" cy="24" r="4.5"/><circle cx="18" cy="39" r="4.5"/><circle cx="36" cy="39" r="4.5"/></g><circle cx="6" cy="39" r="4.5" fill="${theme.fg}" stroke="${theme.fg}" stroke-width="2.5"/>`,
    IndexedDb: `<g ${stroke}><ellipse cx="24" cy="11" rx="15" ry="5.5"/><path d="M9 11v26c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5V11M9 24c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5"/></g>`,
    Permissions: `<g ${stroke}><path d="M24 5 40 11v12c0 10-6.5 17-16 20.500C14.500 40 8 33 8 23V11z"/><path d="m16.5 24 5.5 5.5 10-11"/></g>`
  }
  const tiles = Object.entries(glyphs).map(([name, glyph], index) => {
    const x = PAD + 26 + index * (tile + gap)
    return `<rect x="${x + .5}" y="${top + .5}" width="${tile - 1}" height="104" rx="9" fill="${theme.raised}" stroke="${theme.line}"/>` +
      `<g transform="translate(${x + tile / 2 - 24} ${top + 15})">${glyph.replaceAll(theme.surface, theme.raised)}</g>` +
      text(name, { x: x + tile / 2, y: top + 88, size: 14.5, weight: "mono", fill: theme.muted, anchor: "middle" })
  }).join("")
  return svg(HALF, height, "Effect contributor: Trie, IndexedDb and Permissions modules",
    card(HALF, height, { bg: theme.surface, border: theme.line }) +
    `<g transform="translate(${PAD + 26} 31) scale(.345)">${paths}</g>` +
    text("Contributor. Modules I added:", { x: PAD + 27, y: 121, size: 17.5, fill: theme.muted }) +
    tiles)
}

// --------------------------------------------------------- effect-machine

const machine = (theme) => {
  const height = 290
  const cycle = 6000
  const w = 124
  const h = 54
  const y = 168
  const a = PAD + 26
  const b = HALF - PAD - 26 - w
  const mid = HALF / 2
  const bend = 50
  const top = `M${a + w / 2} ${y}C${a + w / 2} ${y - bend} ${b + w / 2} ${y - bend} ${b + w / 2} ${y - 2}`
  const bottom = `M${b + w / 2} ${y + h}C${b + w / 2} ${y + h + bend} ${a + w / 2} ${y + h + bend} ${a + w / 2} ${y + h + 2}`
  const state = (x, name, cls) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="11" fill="${theme.raised}" stroke="${theme.strong}" stroke-width="1.5"/>` +
    `<g class="${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="11" fill="${theme.violet}"/></g>` +
    text(name, { x: x + w / 2, y: y + 34, size: 20, weight: 600, fill: theme.fg, anchor: "middle" }) +
    `<g class="${cls}">${text(name, { x: x + w / 2, y: y + 34, size: 20, weight: 600, fill: theme.surface, anchor: "middle" })}</g>`
  const label = (name, at, cls) => {
    const body = (fill) => text(name, { x: mid, y: at, size: 16, weight: "mono", fill, anchor: "middle" })
    return body(theme.muted) + `<g class="${cls}">${body(theme.violet)}</g>`
  }
  const arrow = (x, tip, direction) => `<path d="M${x - 6} ${tip - 9 * direction}L${x} ${tip - 1 * direction}L${x + 6} ${tip - 9 * direction}" fill="none" stroke="${theme.strong}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  const style =
    `.l{animation:l ${cycle}ms linear infinite}@keyframes l{0%,36%{opacity:1}37%,86%{opacity:0}87%,100%{opacity:1}}` +
    `.u{opacity:0;animation:u ${cycle}ms linear infinite}@keyframes u{0%,48%{opacity:0}49%,74%{opacity:1}75%,100%{opacity:0}}` +
    `.e{opacity:0;animation:e ${cycle}ms linear infinite}@keyframes e{0%,35%{opacity:0}36%,48%{opacity:1}52%,100%{opacity:0}}` +
    `.f{opacity:0;animation:f ${cycle}ms linear infinite}@keyframes f{0%,73%{opacity:0}74%,86%{opacity:1}90%,100%{opacity:0}}` +
    `.t{stroke-dasharray:22 400;stroke-dashoffset:22;opacity:0}` +
    `.t1{animation:t1 ${cycle}ms linear infinite}@keyframes t1{0%,36%{stroke-dashoffset:22;opacity:0}36.1%{opacity:1}48%{stroke-dashoffset:-220;opacity:1}48.1%,100%{stroke-dashoffset:-220;opacity:0}}` +
    `.t2{animation:t2 ${cycle}ms linear infinite}@keyframes t2{0%,74%{stroke-dashoffset:22;opacity:0}74.1%{opacity:1}86%{stroke-dashoffset:-220;opacity:1}86.1%,100%{stroke-dashoffset:-220;opacity:0}}`
  return svg(HALF, height, "Effect Machine: schema-first state machines and statecharts for Effect",
    card(HALF, height, { bg: theme.surface, border: theme.line }) +
    `<path transform="translate(${PAD + 26} 36) scale(.0756)" fill="${theme.fg}" d="${pixelFreeMark}"/>` +
    text("effect-machine", { x: PAD + 72, y: 62, size: 28, weight: 600, fill: theme.fg, tracking: -.015 }) +
    text("Schema-first statecharts for Effect", { x: PAD + 27, y: 99, size: 17.5, fill: theme.muted }) +
    `<g fill="none" stroke="${theme.strong}" stroke-width="2"><path d="${top}"/><path d="${bottom}"/></g>` +
    arrow(b + w / 2, y, 1) + arrow(a + w / 2, y + h, -1) +
    `<g fill="none" stroke="${theme.violet}" stroke-width="3.5" stroke-linecap="round"><path class="t t1" d="${top}"/><path class="t t2" d="${bottom}"/></g>` +
    state(a, "Locked", "l") + state(b, "Unlocked", "u") +
    label("Coin", y - 14, "e") + label("Push", y + h + 24, "f"), style)
}

/** The Typeonce mark that the effect-machine docs use. */
const pixelFreeMark = "M0 181A181 181 0 0 1 181 0H440A10 10 0 0 1 450 10A96 96 0 0 1 354 106H267A161 161 0 0 0 106 267A10 10 0 0 1 96 277A96 96 0 0 1 0 181ZM171 267A96 96 0 0 1 267 171H297A10 10 0 0 1 307 181V354A96 96 0 0 1 211 450H181A10 10 0 0 1 171 440Z"

// ----------------------------------------------------------------- games

const games = (theme) => {
  const height = 162
  const skin = theme.games
  return svg(FULL, height, "Typeonce Games: original games for web, mobile, and desktop",
    `<defs>${cardClip("c", FULL, height)}</defs>` + card(FULL, height, { bg: skin.bg, border: skin.line }) +
    `<g clip-path="url(#c)">${grid(PAD + 380, PAD, 454, 160, 8, theme, "g")}</g>` +
    `<path transform="translate(${PAD + 34} 41)" shape-rendering="crispEdges" fill="${skin.fg}" d="${pixels(typeonce.wordmark, 2.5)}"/>` +
    lines(["Original games for", "web, mobile, and desktop"], { x: 474, y: 74, leading: 36, size: 27, weight: 600, fill: skin.fg, tracking: -.012 }))
}

/** A source image as a data URI, at most `width` pixels wide. */
const embed = (file, width, work) => {
  const png = join(work, "embed.png")
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(here, "sources/games", file), "-vf", `scale='min(${width},iw)':-2:flags=lanczos`, png])
  return `data:image/png;base64,${readFileSync(png).toString("base64")}`
}

/** Game cards carry a screenshot, so they are rasterised at 3x. */
const rasterise = (name, content, work) => {
  const source = join(work, "card.svg")
  const raster = join(work, "card.png")
  writeFileSync(source, content)
  execFileSync("rsvg-convert", ["--unlimited", "-z", "3", source, "-o", raster])
  execFileSync("cwebp", ["-quiet", "-q", "86", "-alpha_q", "100", "-sharp_yuv", raster, "-o", join(out, `${name}.webp`)])
}

/** The featured game: full width, with its own title art over the track. */
const feature = (theme, mode, work) => {
  const height = 318
  const ink = "#14161a"
  const gold = "#f7b733"
  const left = PAD + 34
  const chip = line("Upcoming", { size: 18, weight: 600, fill: gold })
  rasterise(`game-tabletop-champions-${mode}`, svg(FULL, height, "Tabletop Champions",
    `<defs>${cardClip("c", FULL, height)}<linearGradient id="s" x1="0" x2="1"><stop offset=".24" stop-color="${ink}"/><stop offset=".42" stop-color="${ink}" stop-opacity=".9"/><stop offset=".78" stop-color="${ink}" stop-opacity="0"/></linearGradient></defs>` +
    card(FULL, height, { bg: ink, border: theme.games.line }) +
    `<g clip-path="url(#c)"><image x="184" y="-92" width="834" height="469" href="${embed("tabletop-champions.webp", 1920, work)}"/>` +
    `<rect width="${FULL}" height="${height}" fill="url(#s)"/></g>` +
    `<image x="${left}" y="44" width="402" height="81" href="${embed("tabletop-champions-title.png", 1200, work)}"/>` +
    text("Drift toy cars round a tabletop.", { x: left, y: 176, size: 25, weight: 600, fill: "#ffffff", tracking: -.01 }) +
    text("Master every circuit. Win every car.", { x: left, y: 209, size: 20, fill: "#b9bec7" }) +
    `<rect x="${left + .75}" y="236.75" width="${n(chip.width + 28)}" height="36" rx="5" fill="none" stroke="${gold}" stroke-width="1.5"/>` +
    text("Upcoming", { x: left + 14.75, y: 261, size: 18, weight: 600, fill: gold })), work)
}

const titles = [
  ["inkline-town", "Inkline Town", "Town builder"],
  ["spirit-call", "Spirit Call", "Top-down action"]
]

const tile = ([id, name, genre], theme, mode, work) => {
  const skin = theme.games
  const inner = HALF - PAD * 2
  const shot = Math.round(inner * 9 / 16)
  const height = PAD * 2 + shot + 88
  rasterise(`game-${id}-${mode}`, svg(HALF, height, name,
    `<defs>${cardClip("c", HALF, height)}</defs>` + card(HALF, height, { bg: skin.bg, border: skin.line }) +
    `<g clip-path="url(#c)"><image x="${PAD}" y="${PAD}" width="${inner}" height="${shot}" preserveAspectRatio="xMidYMid slice" href="${embed(`${id}.webp`, 1280, work)}"/></g>` +
    `<path d="M${PAD + 1} ${PAD + shot + .5}h${inner - 2}" stroke="${skin.line}"/>` +
    text(name, { x: PAD + 26, y: PAD + shot + 39, size: 23, weight: 600, fill: skin.fg, tracking: -.01 }) +
    text(genre, { x: PAD + 26, y: PAD + shot + 65, size: 18, fill: skin.muted })), work)
}

// --------------------------------------------------------------- writing

const writing = (theme) => {
  const height = 244
  const x = 520
  const top = 42
  // Each row is a list of [color, width] runs: prose, then a code block, then prose.
  const prose = theme.strong
  const rows = [
    [[theme.fg, 148]], null,
    [[prose, 232]], [[prose, 210]], null,
    "code", [[theme.violet, 34], [theme.blue, 58], [theme.muted, 20]], [[null, 14], [theme.green, 84], [theme.muted, 26]], [[null, 14], [theme.violet, 26], [theme.blue, 70]], "/code", null,
    [[prose, 224]], [[prose, 238]], [[prose, 120]]
  ]
  let y = top + 34
  let order = 0
  let body = ""
  let box = 0
  for (const row of rows) {
    if (row === null) y += 8
    else if (row === "code") { box = y; y += 13 }
    else if (row === "/code") {
      body = `<rect x="${x + 22}" y="${box - 5}" width="248" height="${y - box + 6}" rx="6" fill="${theme.raised}"/>` + body
      y += 8
    } else {
      const inset = rows.indexOf(row) > 5 && rows.indexOf(row) < 9 ? 36 : 24
      let cursor = x + inset
      let runs = ""
      for (const [color, width] of row) {
        if (color) runs += `<rect x="${cursor}" y="${y}" width="${width}" height="${row[0][0] === theme.fg ? 11 : 7}" rx="3.5" fill="${color}"/>`
        cursor += width + (color ? 7 : 0)
      }
      body += `<g class="w" style="animation-delay:${300 + order * 260}ms">${runs}</g>`
      order += 1
      y += row[0][0] === theme.fg ? 18 : 15
    }
  }
  const style = `.w{animation:w 420ms steps(14) backwards}@keyframes w{0%{clip-path:inset(0 100% 0 0)}100%{clip-path:inset(0 0 0 0)}}`
  return svg(FULL, height, "sandromaglione.com: long-form guides and a newsletter, written from real projects",
    `<defs>${cardClip("c", FULL, height)}</defs>` + card(FULL, height, { bg: theme.surface, border: theme.line }) +
    `<g clip-path="url(#c)">${grid(PAD + 380, PAD, 454, 240, 28, theme, "g")}` +
    `<rect x="${x + .5}" y="${top + .5}" width="291" height="260" rx="12" fill="${theme.surface}" stroke="${theme.line}"/>${body}</g>` +
    text("sandromaglione.com", { x: PAD + 34, y: 93, size: 41, weight: 600, fill: theme.fg, tracking: -.022 }) +
    lines(["Long-form guides and a newsletter,", "written from real projects"], { x: PAD + 35, y: 147, leading: 36, size: 25, fill: theme.muted }) +
    "", style)
}

// ---------------------------------------------------------------- social

const social = (icon, theme) =>
  svg(56, 64, icon.title,
    `<rect x="5.5" y="13.5" width="45" height="45" rx="11" fill="${theme.surface}" stroke="${theme.line}"/>` +
    `<path transform="translate(18 26) scale(.8333)" fill="${theme.fg}" d="${icon.path}"/>`)

// ------------------------------------------------------------------ main

const work = mkdtempSync(join(tmpdir(), "readme-art-"))
for (const [mode, theme] of Object.entries(themes)) {
  const save = (name, content) => writeFileSync(join(out, `${name}-${mode}.svg`), content)
  save("hero", hero(theme))
  save("ritmo", ritmo(theme))
  save("effect", effect(theme))
  save("effect-machine", machine(theme))
  save("typeonce-games", games(theme))
  save("sandromaglione", writing(theme))
  save("x", social(siX, theme))
  save("discord", social(siDiscord, theme))
  feature(theme, mode, work)
  for (const title of titles) tile(title, theme, mode, work)
}
rmSync(work, { recursive: true })
