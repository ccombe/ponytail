// PROBE ONLY — deleted before any real commit.
// Answers two open questions against a live opencode 2.x server:
//   1. Does the injected ruleset actually reach the model's system prompt?
//   2. Does our transform run BEFORE or AFTER the built-in agent plugin's
//      unconditional `item.system = ...` assignments (explore/compaction/
//      title/summary)? If after, our injection survives on all of them.

import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { getPonytailInstructions } = require('../../hooks/ponytail-instructions');

const OUT = '/tmp/opencode/probe';
const log = (name, data) => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + '\n---\n');
  } catch (e) {}
};

export default {
  id: 'ponytail',
  setup: async (ctx) => {
    const mode = 'full';
    const instructions = getPonytailInstructions(mode);
    const MARKER = 'PONYTAIL MODE ACTIVE';

    await ctx.agent.transform((agents) => {
      // What does the draft look like the moment OUR transform runs? If the
      // built-ins already ran, explore/title/etc. are present with a system.
      const before = agents.list().map((a) => ({ id: a.id, mode: a.mode, hidden: a.hidden, hasSystem: !!a.system }));
      log('transform-order.json', { before });

      for (const agent of agents.list()) {
        agents.update(agent.id, (a) => {
          if (a.system && a.system.includes(MARKER)) return;
          a.system = a.system ? a.system + '\n\n' + instructions : instructions;
        });
      }

      const after = agents.list().map((a) => ({ id: a.id, injected: !!(a.system && a.system.includes(MARKER)) }));
      log('transform-after.json', { after });
    });

    // NOTE: ctx.aisdk.language does not exist in the released 2.0.17 build
    // (Die: ctx.aisdk.language is not a function). End-to-end confirmation of
    // the system prompt therefore comes from `opencode debug agents` reading
    // the materialized draft, not from wrapping the provider call.

    await ctx.skill.transform((skills) => {
      const dir = path.resolve(__dirname, '../../skills');
      skills.source({ type: 'directory', path: dir });
      log('skills.json', { dir, listed: skills.list().length });
    });
  },
};
