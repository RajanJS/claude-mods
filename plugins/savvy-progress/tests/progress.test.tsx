import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'savvy-progress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** The engine's own band, drawn when the mod passes. */
const engineBand = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

const engine = (on: On) => {
  const clock = mock.clock(on)
  engineBand(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_, e) =>
    e.tool === 'Bash' && e.command === 'false'
      ? { result: {}, isError: true }
      : { result: {} },
  )
  return clock
}

const complete = (turnId: string, agentId?: string) => ({
  turnId,
  answer: 'done',
  durationMs: 65_000,
  isAborted: false,
  reason: 'answer' as const,
  ...(agentId ? { agentId } : {}),
})

test('the bar fills from the to-do list and goes green when done', async ($, on) => {
  const clock = engine(on)

  await $.turn.start({ text: 'Fix the login header\nmore', turnId: 't1' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'a', status: 'completed', activeForm: 'Doing a' },
      { content: 'b', status: 'completed', activeForm: 'Doing b' },
      { content: 'c', status: 'in_progress', activeForm: 'Running tests' },
      { content: 'd', status: 'pending', activeForm: 'Doing d' },
      { content: 'e', status: 'pending', activeForm: 'Doing e' },
    ],
  })
  await $.tool.call({ tool: 'Bash', command: 'false', description: 'Fail' })
  await $.turn.start({ text: 'sub', turnId: 's1', agentId: 'sub1' })
  await clock.advance(42_000)

  // Terminal: the text bar.
  {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /Running tests/ }))?.text).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /█/ }))?.text).toContain('░')
    expect((await ui.find({ type: 'Text', text: /Tasks/ }))?.text).toContain('Tasks 2/5')
    expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toContain('40%')
    expect((await ui.find({ type: 'Text', text: /0:42/ }))?.text).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /failed/ }))?.text).toContain('1 failed')
    expect((await ui.find({ type: 'Text', text: /×/ }))?.text).toContain('▣ ×1')
    await ui.unmount()
  }

  // Desktop and the editor: the pixel bar and a walking crab, as an SVG.
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const svg = await ui.find({ type: 'Svg' })
    const source = String(svg?.props.source)
    expect(svg?.props.alt).toBe('Tasks 2/5, 40%')
    expect(source.startsWith('<svg')).toBe(true)
    expect(source).toContain('class="t')
    expect(source).toContain('class="run"')
    expect(source).toContain('>Tasks 2/5</text>')
    expect((await ui.find({ type: 'Text', text: /Running tests/ }))?.text).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toBe('40%')
    expect((await ui.find({ type: 'Text', text: /×/ }))?.text).toBe('×1')
    expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
    await ui.unmount()
  }

  await $.turn.complete(complete('s1', 'sub1'))
  await $.turn.complete(complete('t1'))

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Done/ }))?.text).toContain('Done')
  expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toContain('100%')
  expect(await ui.find({ type: 'Text', text: /×/ })).toBeUndefined()
  await ui.unmount()

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const done = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(done).toContain('#5fbf8f')
  expect(done).not.toContain('class="run"')
  await desk.press({ key: 'dismiss' })
  expect((await desk.find({ type: 'Text' }))?.text).toBe('engine')
  await desk.unmount()
})

test('the terminal row can be dismissed', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'x', turnId: 't1' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'dismiss' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('with no to-do list the prompt is the title and tools are counted', async ($, on) => {
  engine(on)

  await $.turn.start({ text: 'commit it', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/a/b.md' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /commit it/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /tools/ }))?.text).toContain('1 tools')
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
  await ui.unmount()
})

test('nothing of the mod shows before the first turn', async ($, on) => {
  engineBand(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
