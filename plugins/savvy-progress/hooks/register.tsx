import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRow, Flow, Todo } from '../types'

const flow = atom({ plugin: 'savvy-progress', key: 'flow' } as const, null)
const isHidden = atom(
  { plugin: 'savvy-progress', key: 'isHidden' } as const,
  false,
)
// Change the tag when AgentRow's fields change: it declines rows an earlier
// version stored, which outlive a reload.
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [], {
  shape: 'agents-1',
})
const now = atom({ plugin: 'savvy-progress', key: 'now' } as const, 0)
const isPanelShown = atom(
  { plugin: 'savvy-progress', key: 'isPanelShown' } as const,
  false,
)

const PANEL = 'savvy-agents'
const KEEP_AGENTS = 30

const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'
const CLAY = '#D97757'
const FAILED = '#e5484d'

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

/** A sweeping block for a turn with no to-do list: it moves once a second. */
const sweep = (width: number, seconds: number) => {
  const block = Math.max(2, Math.floor(width / 5))
  const span = width + block
  const head = seconds % span
  let bar = ''
  for (let i = 0; i < width; i++) {
    bar += i <= head && i > head - block ? '█' : '░'
  }
  return bar
}

const fill = (width: number, ratio: number) => {
  const filled = Math.round(width * Math.min(1, Math.max(0, ratio)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// ---- The pixel bar and crab, after JohnnyVizz/claude-kit's savvy-progress (MIT) ----

const H = 22
const BAR_H = 16
const BAR_Y = (H - BAR_H) / 2
const CELL = 3
const CRAB_W = 26
const CRAB_SCALE = 0.8
const INK = '#1F1E1D'
const FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

/** Deterministic per cell, so the dither holds still between redraws. */
const noise = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Dithered 2×2 pixels from column `from` to `to`, denser toward the leading edge. */
const dither = (from: number, to: number) => {
  const cols = Math.floor(to / CELL)
  const rows = Math.floor(BAR_H / CELL)
  const span = Math.max(1, cols - from)
  let out = ''
  for (let c = from; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow((c - from) / span, 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) {
        const t = Math.floor(noise(r, c) * 4)
        out += `<rect class="t${t}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`
      }
    }
  }
  return out
}

const CRAB_CSS = `
    .run .la{animation:st .5s steps(1) infinite}
    .run .lb{animation:st .5s steps(1) infinite -.25s}
    .run .bd{animation:bob .5s steps(1) infinite -.125s}
    @keyframes st{50%{transform:translateY(-1px)}}
    @keyframes bob{50%{transform:translateY(1px)}}`

/** A plain clay crab on a 30-unit grid; its legs step while it walks. */
const crab = (x: number, isWalking: boolean) => `
  <g transform="translate(${x} 0) scale(${CRAB_SCALE})" class="${isWalking ? 'run' : ''}">
    <g class="bd">
      <rect x="7" y="10" width="16" height="12" fill="${CLAY}"/>
      <rect x="3" y="14" width="4" height="4" fill="${CLAY}"/>
      <rect x="23" y="14" width="4" height="4" fill="${CLAY}"/>
      <rect x="9" y="12" width="2" height="2" fill="${INK}"/>
      <rect x="19" y="12" width="2" height="2" fill="${INK}"/>
    </g>
    <g class="la" fill="${CLAY}"><rect x="7" y="22" width="2" height="4"/><rect x="17" y="22" width="2" height="4"/></g>
    <g class="lb" fill="${CLAY}"><rect x="11" y="22" width="2" height="4"/><rect x="21" y="22" width="2" height="4"/></g>
  </g>`

/** One crab on its own, for an agent's row in the panel. */
const crabSvg = (isWalking: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" width="${CRAB_W}" height="${H}" viewBox="0 0 ${CRAB_W} ${H}">
  <style>${CRAB_CSS}
    @media (prefers-reduced-motion: reduce){*{animation:none!important}}
  </style>
  ${crab(1, isWalking)}
</svg>`

type BarDrawing = {
  width: number
  /** 0..1, or null for a turn with no to-do list (a sweeping block instead). */
  ratio: number | null
  /** 0..1 of the bar handed to running work (done + in progress). */
  running: number
  total: number
  seconds: number
  label: string
  tone: string
  isDone: boolean
  isWalking: boolean
}

const barSvg = (d: BarDrawing) => {
  const barW = Math.max(60, d.width - CRAB_W - 6)
  const ratio = d.ratio ?? 0
  const fillW = Math.round(barW * ratio)
  const runW = Math.round(barW * d.running)

  let pixels: string
  let edge: number
  if (d.ratio === null) {
    // No to-do list: a dithered block sweeps across, one step a second.
    const block = Math.max(CELL * 6, Math.round(barW / 5))
    const head = ((d.seconds * CELL * 4) % (barW + block)) - block
    const from = Math.max(0, Math.floor(head / CELL))
    pixels = dither(from, Math.min(barW, head + block))
    edge = Math.min(barW, head + block)
  } else {
    pixels = dither(0, fillW)
    edge = fillW
  }

  const faint =
    d.ratio === null || runW <= fillW
      ? ''
      : `<g opacity="0.45">${(() => {
          let out = ''
          const rows = Math.floor(BAR_H / CELL)
          for (let c = Math.floor(fillW / CELL); c < Math.floor(runW / CELL); c++) {
            for (let r = 0; r < rows; r++) {
              if (noise(c + 7, r + 3) < 0.2) {
                out += `<rect x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7" fill="${d.tone}"/>`
              }
            }
          }
          return out
        })()}</g>`

  let ticks = ''
  for (let i = 1; i < d.total; i++) {
    const x = Math.round((barW * i) / d.total)
    if (x > fillW + 4) {
      ticks += `<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75" fill="rgba(128,128,128,.45)"/>`
    }
  }

  const pillW = Math.round(18 + d.label.length * 6.6)
  const pillX = Math.min(Math.max(0, Math.round(edge - pillW / 2)), barW - pillW)

  const slow = d.isDone
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${H}" viewBox="0 0 ${d.width} ${H}">
  <style>
    .t0,.t1,.t2,.t3{fill:${d.tone};animation:tw ${slow ? 3.2 : 2.2}s ease-in-out infinite}
    .t1{animation-duration:${slow ? 3.8 : 2.8}s;animation-delay:-.7s}
    .t2{animation-duration:${slow ? 2.9 : 1.9}s;animation-delay:-1.3s}
    .t3{animation-duration:${slow ? 4.3 : 3.3}s;animation-delay:-.4s}
    @keyframes tw{0%,100%{opacity:1}50%{opacity:${slow ? 0.8 : 0.3}}}
    ${CRAB_CSS}
    @media (prefers-reduced-motion: reduce){*{animation:none!important}}
  </style>
  <defs><clipPath id="c"><rect width="${barW}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
  <g transform="translate(0 ${BAR_Y})">
    <rect width="${barW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="rgba(128,128,128,.16)"/>
    <g clip-path="url(#c)">${faint}${pixels}${ticks}</g>
    <rect x="${pillX}" y="1" width="${pillW}" height="${BAR_H - 2}" rx="${(BAR_H - 2) / 2}" fill="${d.tone}"/>
    <text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#fff">${xml(d.label)}</text>
  </g>
  ${crab(barW + 6, d.isWalking)}
</svg>`
}

const tokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)

const baseName = (path: string) => path.split('/').pop() ?? path

const STATUS_WORD: Record<AgentRow['status'], string> = {
  running: 'running',
  completed: 'done',
  failed: 'failed',
  stopped: 'stopped',
}

const statusTone = (status: AgentRow['status']) =>
  status === 'running' ? ACCENT : status === 'completed' ? DONE : FAILED

/** Keep a list that still has open items; a finished one starts over next turn. */
const carryTodos = (todos: Todo[]) =>
  todos.some(t => t.status !== 'completed') ? todos : []

// The module's own clock state; a reload starts it over, as it does the module.
let startedAt = 0
let tick: Timer | undefined

function stopTick() {
  tick?.cancel()
  tick = undefined
}

/**
 * One clock for the bar and the panel: it ticks while the main turn or any
 * agent runs (a background agent outlives the turn that started it).
 */
function ensureTick($: EngineInterface) {
  if (tick) {
    return
  }
  tick = $.clock.every(1000, async () => {
    const at = await $.clock.now()
    await update($, now, () => at)
    const seconds = Math.floor((at - startedAt) / 1000)
    const f = await update($, flow, f =>
      f && f.isRunning ? { ...f, seconds } : f,
    )
    if (f?.isRunning) {
      $.ui.status(`⏳ ${clock(seconds)} · ${f.tools} tools`)
    }
    const list = await read($, agents)
    if (!f?.isRunning && !list.some(a => a.status === 'running')) {
      stopTick()
    }
  })
}

async function showPanel($: EngineInterface) {
  await $.ui.open({ id: PANEL, title: 'Agents' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'savvy-agents',
      description: 'Show the agents panel: each subagent, its time, tools and tokens',
    })

    return next(e)
  })

  on('command.run', { command: 'savvy-agents' }, async $ => {
    await update($, isPanelShown, () => true)
    await showPanel($)

    return { text: 'Agents panel opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny !== undefined || spawned.agentId === undefined) {
      return spawned
    }

    const at = await $.clock.now()
    const row: AgentRow = {
      id: spawned.agentId,
      type: e.subagentType,
      description: e.description,
      model: spawned.model,
      status: 'running',
      startedAt: at,
      endedAt: null,
      tools: 0,
      current: null,
      outTokens: 0,
      ctxTokens: 0,
    }
    await update($, agents, list =>
      [...list.filter(a => a.id !== row.id), row].slice(-KEEP_AGENTS),
    )
    await update($, now, () => at)
    ensureTick($)

    // The panel opens by itself once a session; /savvy-agents opens it again.
    if (!(await read($, isPanelShown))) {
      await update($, isPanelShown, () => true)
      void showPanel($)
    }

    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    // A subagent's turn is a worker of the main turn: it counts in ×N.
    if (e.agentId !== undefined) {
      const id = e.agentId
      await update($, flow, f =>
        f && !f.agents.includes(id) ? { ...f, agents: [...f.agents, id] } : f,
      )
      return next(e)
    }

    startedAt = await $.clock.now()
    await update($, flow, f => ({
      isRunning: true,
      title: firstLine(e.text) || 'Working',
      seconds: 0,
      tools: 0,
      failed: 0,
      todos: carryTodos(f?.todos ?? []),
      agents: [],
      outcome: null,
    }))
    await update($, isHidden, () => false)

    await update($, now, () => startedAt)
    ensureTick($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const todos = isMain && e.tool === 'TodoWrite' ? e.todos : null

    const agentId = e.agentId
    const label =
      e.tool === 'Bash'
        ? `Bash: ${clip(e.description ?? e.command, 40)}`
        : e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'Read'
          ? `${e.tool}: ${baseName(e.file_path)}`
          : e.tool

    if (agentId === undefined) {
      await update($, flow, f =>
        f && f.isRunning ? { ...f, tools: f.tools + 1 } : f,
      )
    } else {
      await update($, agents, list =>
        list.map(a =>
          a.id === agentId ? { ...a, tools: a.tools + 1, current: label } : a,
        ),
      )
    }

    const ran = await next(e)

    if (agentId !== undefined) {
      await update($, agents, list =>
        list.map(a =>
          a.id === agentId && a.current === label ? { ...a, current: null } : a,
        ),
      )
    }
    const hasFailed = ran.deny === undefined && ran.isError === true

    if (isMain) {
      await update($, flow, f =>
        f && f.isRunning
          ? {
              ...f,
              failed: hasFailed ? f.failed + 1 : f.failed,
              todos: todos && !hasFailed ? todos : f.todos,
            }
          : f,
      )
    }

    return ran
    // Progress is only a display: if counting fails, the tool call still goes on.
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const at = await $.clock.now()
      const usage = e.usage
      // How the agent's run ended: the answer, a stop, or an error.
      const status: AgentRow['status'] =
        e.reason === 'answer'
          ? 'completed'
          : e.reason === 'aborted'
            ? 'stopped'
            : 'failed'
      await update($, flow, f =>
        f ? { ...f, agents: f.agents.filter(a => a !== id) } : f,
      )
      await update($, agents, list =>
        list.map(a =>
          a.id === id
            ? {
                ...a,
                status: a.status === 'running' ? status : a.status,
                endedAt: a.endedAt ?? at,
                current: null,
                outTokens: a.outTokens + (usage?.output_tokens ?? 0),
                ctxTokens: usage
                  ? usage.input_tokens +
                    usage.cache_read_input_tokens +
                    (usage.cache_creation_input_tokens ?? 0)
                  : a.ctxTokens,
              }
            : a,
        ),
      )
      return next(e)
    }

    await update($, now, () => startedAt + e.durationMs)
    const seconds = Math.round(e.durationMs / 1000)
    await update($, flow, f =>
      f ? { ...f, isRunning: false, seconds, outcome: e.reason } : f,
    )
    $.ui.status(undefined)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, flow)
    if (e.props.hasSurvey || f === null || (await read($, isHidden))) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui

    const total = f.todos.length
    const done = f.todos.filter(t => t.status === 'completed').length
    const active = f.todos.find(t => t.status === 'in_progress')
    const isDone = !f.isRunning && f.outcome === 'answer'
    const isStopped = !f.isRunning && !isDone

    const title = active?.activeForm ?? f.title
    const label = isDone
      ? 'Done'
      : isStopped
        ? f.outcome === 'aborted'
          ? 'Stopped'
          : 'Error'
        : total > 0
          ? `Tasks ${done}/${total}`
          : `${f.tools} tools`
    const ratio = isDone ? 1 : total > 0 ? done / total : 0
    const percent = total > 0 || isDone ? `${Math.round(ratio * 100)}%` : ''

    const tone = isDone ? DONE : isStopped ? FAILED : ACCENT
    const cols = e.props.bodyColumns
    const dismiss = (
      <Button
        key="dismiss"
        label="✕"
        onPress={() => update($, isHidden, () => true)}
      />
    )

    // Desktop and the editor: the pixel bar and the crab, drawn as an SVG.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const inProgress = f.todos.filter(t => t.status === 'in_progress').length
      const titleChars = Math.min(36, title.length)
      const rowW = Math.max(180, Math.min(1600, (cols || 100) * 8 - 96))
      const width = Math.max(
        140,
        Math.min(900, rowW - titleChars * 7.5 - 150 - (f.agents.length ? 40 : 0)),
      )
      const source = barSvg({
        width,
        ratio: isDone ? 1 : total > 0 ? done / total : f.isRunning ? null : 0,
        running: total > 0 ? Math.min(1, (done + inProgress) / total) : 0,
        total,
        seconds: f.seconds,
        label,
        tone,
        isDone,
        isWalking: f.isRunning,
      })

      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text color={tone}>●</Text>
          <Text weight="medium">{clip(title, 36)}</Text>
          <Svg
            source={source}
            alt={`${label}${percent ? `, ${percent}` : ''}`}
            width={width}
            height={H}
          />
          {percent ? <Text dimColor>{percent}</Text> : null}
          <Text dimColor>{clock(f.seconds)}</Text>
          {f.failed > 0 ? (
            <Text color={FAILED}>{`${f.failed} failed`}</Text>
          ) : null}
          {f.agents.length > 0 ? (
            <Text color={CLAY}>{`×${f.agents.length}`}</Text>
          ) : null}
          {dismiss}
        </Box>
      )
    }

    const titleW = Math.max(8, Math.min(30, title.length + 2, Math.floor(cols / 3)))
    const barW = Math.max(6, Math.min(40, cols - titleW - 32))
    const bar =
      total === 0 && f.isRunning ? sweep(barW, f.seconds) : fill(barW, ratio)

    return (
      <Box>
        <Text color={tone}>● </Text>
        <Text>{clip(title, titleW)} </Text>
        <Text color={tone}>{bar}</Text>
        <Text weight="bold">{`  ${label}`}</Text>
        {percent ? <Text dimColor>{`  ${percent}`}</Text> : null}
        <Text dimColor>{`  ${clock(f.seconds)}`}</Text>
        {f.failed > 0 ? (
          <Text color={FAILED}>{`  ${f.failed} failed`}</Text>
        ) : null}
        {f.agents.length > 0 ? (
          <Text color={CLAY}>{`  ▣ ×${f.agents.length}`}</Text>
        ) : null}
        <Text> </Text>
        {dismiss}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const list = await read($, agents)
    const at = await read($, now)
    const hasSvg = e.surface !== 'terminal' && 'Svg' in ui

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No agents yet in this session.</Text>
          <Text dimColor>Each subagent shows here with its time, tools and tokens.</Text>
        </Box>
      )
    }

    const running = list.filter(a => a.status === 'running').length
    const finished = list.length - running
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 3) / 2))
    // Running agents first, then the newest finished ones.
    const shown = [
      ...list.filter(a => a.status === 'running'),
      ...list.filter(a => a.status !== 'running').reverse(),
    ].slice(0, room)

    const row = (a: AgentRow) => {
      const seconds = Math.max(
        0,
        Math.floor(((a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt) / 1000),
      )
      const facts = [
        clock(seconds),
        `${a.tools} tools`,
        ...(a.ctxTokens > 0 ? [`${tokens(a.ctxTokens)} ctx`] : []),
        ...(a.outTokens > 0 ? [`${tokens(a.outTokens)} out`] : []),
      ].join(' · ')
      const tone = statusTone(a.status)
      const lines = (
        <Box flexDirection="column">
          <Text>
            <Text weight="semibold">{a.type}</Text>
            <Text dimColor>{` · ${clip(a.description, 48)}`}</Text>
          </Text>
          <Text>
            <Text color={tone}>{STATUS_WORD[a.status]}</Text>
            <Text dimColor>{` · ${facts}`}</Text>
            {a.current ? <Text dimColor>{` · ${clip(a.current, 40)}`}</Text> : null}
          </Text>
        </Box>
      )

      if (hasSvg && 'Svg' in ui) {
        const { Svg } = ui
        return (
          <Box key={a.id} flexDirection="row" alignItems="center" gap={1}>
            <Svg
              source={crabSvg(a.status === 'running')}
              alt={`${a.type} ${STATUS_WORD[a.status]}`}
              width={CRAB_W}
              height={H}
            />
            {lines}
          </Box>
        )
      }

      return (
        <Box key={a.id} flexDirection="row" gap={1}>
          <Text color={CLAY}>▣</Text>
          {lines}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{`${running} running · ${finished} finished`}</Text>
          {finished > 0 ? (
            <Button
              key="clear"
              label="Clear finished"
              onPress={() =>
                update($, agents, l => l.filter(a => a.status === 'running'))
              }
            />
          ) : null}
        </Box>
        {shown.map(row)}
      </Box>
    )
  })
}
