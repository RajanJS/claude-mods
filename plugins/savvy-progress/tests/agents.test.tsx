import { expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, CommandRunInput, TurnUsage } from 'claude-code'

// The kit fills in the engine's own fields (provider, origin and the rest).
const spawn = (input: Pick<AgentSpawnInput, 'prompt' | 'description' | 'subagentType'>) =>
  input as AgentSpawnInput

const PANEL = {
  plugin: 'savvy-progress',
  component: 'Pane',
  requestId: 'savvy-agents',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('a subagent shows in the panel while it runs and after it ends', async ($, on) => {
  const clock = mock.clock(on)
  let opened = 0
  let next = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${++next}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn(spawn({ prompt: 'p', description: 'Read the claude-kit bar', subagentType: 'Explore' }))
  await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/register.tsx', agentId: 'a1' })
  await clock.advance(30_000)

  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Explore running')
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('class="run"')
    expect((await ui.find({ type: 'Text', text: /^Explore$/ }))?.text).toBe('Explore')
    expect((await ui.find({ type: 'Text', text: /0:30/ }))?.text).toContain('0:30 · 1 tools')
    expect((await ui.find({ type: 'Text', text: /1 running/ }))?.text).toBe('1 running · 0 finished')
    await ui.unmount()
  }

  await $.turn.complete({
    turnId: 's1',
    agentId: 'a1',
    answer: 'ok',
    durationMs: 31_000,
    isAborted: false,
    reason: 'answer',
    usage: {
      input_tokens: 2000,
      output_tokens: 1500,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 0,
    } as TurnUsage,
  })
  await clock.advance(60_000)

  // A second agent: the panel opened by itself only once.
  await $.agent.spawn(spawn({ prompt: 'p', description: 'Second', subagentType: 'general-purpose' }))
  expect(opened).toBe(1)

  const ui = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^done$/ }))?.text).toBe('done')
  // The finished agent's clock stopped when it ended.
  expect((await ui.find({ type: 'Text', text: /12\.0k ctx/ }))?.text).toContain('0:30 · 1 tools · 12.0k ctx · 1.5k out')
  expect((await ui.find({ type: 'Text', text: /▣/ }))?.text).toBe('▣')
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /^Explore$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /1 running/ }))?.text).toBe('1 running · 0 finished')
  await ui.unmount()
})

test('/savvy-agents opens the panel, which says when it is empty', async ($, on) => {
  let opened = 0
  on('command.register', () => ({ value: { command: 'savvy-agents' } }))
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })

  const ran = await $.command.run({ command: 'savvy-agents', args: '' } as CommandRunInput)
  expect(ran.text).toBe('Agents panel opened.')
  expect(opened).toBe(1)

  const ui = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /No agents/ }))?.text).toBe('No agents yet in this session.')
  await ui.unmount()
})
