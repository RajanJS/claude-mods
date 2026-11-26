export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

/** The turn in flight, or the one that just ended. */
export type Flow = {
  isRunning: boolean
  /** The prompt's first line, the bar's title when no to-do is in progress. */
  title: string
  /** Whole seconds since the prompt was sent (frozen once the turn ends). */
  seconds: number
  /** Tool calls on the main loop. */
  tools: number
  /** Tool calls that came back as errors. */
  failed: number
  /** The model's to-do list as TodoWrite last wrote it. */
  todos: Todo[]
  /** Ids of the subagents whose turns are running. */
  agents: string[]
  /** How the turn ended, once it has. */
  outcome: 'answer' | 'aborted' | 'refusal' | 'error' | null
}

/** One subagent in the agents panel. */
export type AgentRow = {
  id: string
  /** The agent type: Explore, general-purpose, a plugin's agent, fork. */
  type: string
  /** The Agent call's short description. */
  description: string
  model: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  /** Clock times in milliseconds. */
  startedAt: number
  endedAt: number | null
  tools: number
  /** What it is running right now, e.g. "Read: register.tsx". */
  current: string | null
  /** Output tokens over its turns. */
  outTokens: number
  /** Context the latest turn read: input, cache reads and cache writes. */
  ctxTokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      flow: Flow | null
      isHidden: boolean
      agents: Shaped<AgentRow[]>
      /** The clock's time at the last tick, so the panel's timers move. */
      now: number
      /** The panel has been opened this session (it opens once by itself). */
      isPanelShown: boolean
    }
  }
}
