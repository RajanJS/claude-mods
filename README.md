# claude-mods

Mods for Claude Code.

## savvy-progress

A progress bar above the prompt, and a live panel of the subagents Claude starts.

**The bar** shows the turn as it runs: the step in progress (or your prompt), a bar that fills from Claude's to-do list (`Tasks 2/5`, `40%`), elapsed time, failed tool calls and `×N` running subagents. With no to-do list, a block sweeps across instead. When the turn ends the bar turns green at `Done`; `✕` hides it until the next turn.

- **Desktop app and VS Code:** a dithered pixel bar with a walking clay crab.
- **Terminal:** a `█░` text bar.

```
● Running tests   ████████████████░░░░░░░░░░░░░░░░░░░░░░░░  Tasks 2/5  40%  0:42  ▣ ×1  ✕
```

**The agents panel** opens the first time Claude starts a subagent in a session, and with `/savvy-agents`. Each agent shows its type and task, running/done/failed/stopped, elapsed time, tool calls, the tool it is running now, and tokens (`ctx`: context at its last step, `out`: tokens written). Running agents come first; **Clear finished** empties the rest.

### Install

At the prompt of a Claude Code terminal session:

```
/plugin install savvy-progress --marketplace RajanJS/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install savvy-progress --marketplace RajanJS/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `RajanJS/claude-mods`, then **Add plugin**.

### Notes

- Built on Claude Code's function hooks (early access); written against Claude Code 2.1.332. The API may change between releases.
- The bar's done/total comes from Claude's `TodoWrite` to-do list; sessions without it show the sweeping bar.
- Tests: `claude plugin test plugins/savvy-progress`.

### Credits

The pixel bar, the crab and the layout follow the `savvy-progress` plugin in [JohnnyVizz/claude-kit](https://github.com/JohnnyVizz/claude-kit) (MIT). This version is rewritten to work on every turn without its savvy-flow orchestrator.
