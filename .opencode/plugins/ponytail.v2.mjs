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

const OUT = '/home/chris/.cache/ponytail-probe';
const log = (name, data) => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + '\n---\n');
  } catch (e) {}
};

export default {
  id: 'ponytail',
  setup: async (ctx) => {
    fs.writeFileSync('/home/chris/.cache/ponytail-probe-setup.txt', 'setup ran ' + new Date().toISOString() + '\n');
    const mode = 'full';
    const instructions = getPonytailInstructions(mode);
    const MARKER = 'PONYTAIL MODE ACTIVE';

    fs.writeFileSync('/home/chris/.cache/ponytail-probe-reg.txt', 'registering\n');
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

      fs.writeFileSync('/home/chris/.cache/ponytail-probe-ran.txt', 'transform ran ' + new Date().toISOString() + '\n');
      const after = agents.list().map((a) => ({ id: a.id, injected: !!(a.system && a.system.includes(MARKER)) }));
      log('transform-after.json', { after });
    });

    // NOTE: ctx.aisdk.language does not exist in the released 2.0.17 build
    // (Die: ctx.aisdk.language is not a function). End-to-end confirmation of
    // the system prompt therefore comes from `opencode debug agents` reading
    // the materialized draft, not from wrapping the provider call.

    await ctx.skill.transform((skills) => {
      const dir = path.resolve(__dirname, '../../skills');
      const md = path.join(dir, 'ponytail', 'SKILL.md');
      const raw = fs.readFileSync(md, 'utf8');
      const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
      const body = raw.slice(m[0].length);
      const fm = {};
      for (const line of m[1].split('\n')) { const kv = /^([a-z-]+):\s*(.*)$/.exec(line); if (kv) fm[kv[1]] = kv[2].trim(); }
      const results = { fmKeys: Object.keys(fm), bodyLen: body.length };
      const attempts = {
        'id+name+path': { id: 'ponytail', name: 'ponytail', path: md },
        'full': { id: 'ponytail', name: 'ponytail', description: fm.description, path: md, content: body },
      };
      for (const [name, arg] of Object.entries(attempts)) {
        try { skills.add(arg); results[name] = 'OK'; }
        catch (e) { results[name] = String(e).slice(0, 160); }
      }
      const found = skills.list().find((x) => x.id === 'ponytail');
      results.foundContent = found ? String(found.content).slice(0, 80) : null;
      results.foundMarker = found ? String(found.content).includes('PONYTAIL MODE ACTIVE') : null;
      log('skill-shapes.json', results);
    });
  },
};
