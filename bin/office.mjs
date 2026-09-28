#!/usr/bin/env node
// 칠판 CLI for the 회의실 facilitator session (meeting-room design §3). Calls the same usecases as the
// server (same validation, same files, OFFICE_HOME via config), so no server is needed.
// Always prints one JSON value; any failure exits 1 with { "error": "…" }.
import { parseArgs } from 'node:util';
import { listTodos, createTodo, updateTodo, deleteTodo, folders } from '../src/usecases/todos.mjs';
import { narrateNote } from '../src/usecases/narrate.mjs';

const USAGE = [
    'usage: node bin/office.mjs <command>',
    '  todo list',
    '  todo add "제목" --folder /abs/path [--detail "…"] [--source scrum]',
    '  todo update <id> [--title "…"] [--detail "…"] [--folder /abs/path] [--done true|false]',
    '  todo delete <id>',
    '  folders',
    '  narrate',
].join('\n');

const OPTIONS = { title: { type: 'string' }, detail: { type: 'string' }, folder: { type: 'string' }, source: { type: 'string' }, done: { type: 'string' } };
// --done true|false -> boolean; anything else goes through as is and the usecase rejects it.
const BOOL = { true: true, false: false };

// One row per command: positional args after the command words, allowed options, the call.
const COMMANDS = {
    'todo list': { args: 0, options: [], run: () => listTodos() },
    'todo add': {
        args: 1,
        options: ['folder', 'detail', 'source'],
        run: ([title], { source, ...fields }) => createTodo({ title, ...fields }, Date.now(), { source }),
    },
    'todo update': {
        args: 1,
        options: ['title', 'detail', 'folder', 'done'],
        run: ([id], { done, ...fields }) => updateTodo(id, done === undefined ? fields : { ...fields, done: Object.hasOwn(BOOL, done) ? BOOL[done] : done }),
    },
    'todo delete': { args: 1, options: [], run: ([id]) => deleteTodo(id) },
    folders: { args: 0, options: [], run: () => ({ folders: folders() }) },
    narrate: { args: 0, options: [], run: () => narrateNote() },
};

const usageError = reason => ({ error: `${reason}\n${USAGE}` });

const run = argv => {
    const parsed = (() => {
        try {
            return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
        } catch (e) {
            return { error: e.message };
        }
    })();
    if (parsed.error) return usageError(parsed.error);
    const { positionals, values } = parsed;
    const words = positionals[0] === 'todo' ? 2 : 1;
    const name = positionals.slice(0, words).join(' ');
    const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
    if (!command) return usageError(`unknown command: ${name || '(none)'}`);
    const args = positionals.slice(words);
    if (args.length !== command.args) return usageError(`${name}: expected ${command.args} argument(s), got ${args.length}`);
    const extra = Object.keys(values).find(k => !command.options.includes(k));
    if (extra) return usageError(`${name}: unknown option --${extra}`);
    return command.run(args, values);
};

const result = await (async () => {
    try {
        return await run(process.argv.slice(2));
    } catch (e) {
        return { error: String(e.message || e) };
    }
})();
process.stdout.write(`${JSON.stringify(result.error ? { error: result.error } : result, null, 2)}\n`);
if (result.error) process.exitCode = 1;
