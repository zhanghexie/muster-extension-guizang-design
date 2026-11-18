import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { skillsFor, recipesFor, nextOfWork, nextIssue, voiceFor } from './recipes.mjs';

const skills = new Set([...skillsFor('zh').map(skill => skill.name), 'guizang-voice']);
function checkedId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('作品 ID 需要小写字母、数字或短横线');
  return id;
}
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('字段为空或超长');
  return value;
}
export function createDomainRuntime({ broker, identity, packageRoot }) {
  const listeners = new Set();
  let queue = Promise.resolve();
  const read = async context => {
    const stored = await broker('data.read', ['studio.json'], context);
    return stored ? JSON.parse(stored.content) : { version: 0, voice: '', works: [] };
  };
  const summary = ({ contentFile, ...work }) => work;
  async function execute(name, args, context) {
    const state = await read(context);
    if (name === 'voice.save') state.voice = text(args.text, 32000);
    else if (name === 'voice.note') state.voice = text(state.voice + '\n\n- ' + text(args.text, 2000), 32000);
    else if (name === 'work.remove') state.works = state.works.filter(work => work.id !== checkedId(args.id));
    else if (name === 'work.relink') {
      const work = state.works.find(item => item.id === checkedId(args.id));
      if (context.actor !== 'human' || !context.taskRef || !work?.relativePath || work.sessionId !== args.previousSessionId || work.taskRef) throw new Error('作品来源已变更，请重新打开作品库');
      work.taskRef = context.taskRef;
    } else if (name === 'work.save') {
      const id = checkedId(args.id);
      if (!skills.has(args.skill)) throw new Error('未知创作技能');
      const work = { id, title: text(args.title, 200), skill: args.skill, theme: args.theme == null ? '' : text(args.theme, 160), column: args.column == null ? '' : text(args.column, 160), updatedAt: new Date().toISOString() };
      if (args.relativePath !== undefined) {
        const file = text(args.relativePath, 1024).replaceAll('\\', '/');
        if (!context.sessionId || file.startsWith('/') || file.includes(':') || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('请登记当前项目中的作品');
        work.kind = 'project';
        work.relativePath = file;
        work.sessionId = context.sessionId;
        if (context.taskRef) work.taskRef = context.taskRef;
      } else if (args.html !== undefined && args.images === undefined) {
        work.kind = 'html';
        const html = text(args.html, 1048576);
        if (Buffer.byteLength(html) > 1048576) throw new Error('作品超过宿主单文件 1 MiB 限制');
        const hash = createHash('sha256').update(html).digest('hex');
        work.contentFile = 'works/' + hash + '.html';
        await broker('data.write', [work.contentFile, html], context);
      } else if (args.html === undefined && Array.isArray(args.images) && args.images.length && args.images.length <= 32) {
        work.kind = 'image';
        work.images = [...new Set(args.images)];
        if (work.images.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))) throw new Error('图片资产 ID 不合法');
      } else throw new Error('请提供 HTML 或图片资产');
      state.works = [work, ...state.works.filter(row => row.id !== id)];
    } else throw new Error('未知命令');
    state.version++;
    await broker('data.write', ['studio.json', JSON.stringify(state)], context);
    for (const listen of listeners) listen({ ...identity, type: 'state.changed', version: state.version, actor: context.actor, requestId: context.requestId, payload: {} });
    return { ok: true, version: state.version, result: {} };
  }
  return {
    async getSnapshot(context = { identity }) {
      await queue;
      const { version, voice, works } = await read(context);
      return { version, capturedAt: new Date().toISOString(), state: { hasVoice: !!voice, works: works.map(summary) } };
    },
    async query(name, args, context = { identity }) {
      if (name === 'skill.location' && skills.has(args.skill)) return { skillRoot: path.join(packageRoot, 'skills', args.skill), examplesRoot: path.join(packageRoot, 'examples') };
      if (name === 'catalog' || name === 'example.html') {
        const lang = args.lang === 'en' ? 'en' : 'zh';
        const base = path.join(packageRoot, 'examples');
        const manifest = JSON.parse(await readFile(path.join(base, lang === 'en' ? 'en/manifest.json' : 'manifest.json'), 'utf8'));
        const examples = manifest.examples;
        if (name === 'example.html') {
          const item = examples.find(row => row.id === args.id && row.kind === 'html');
          if (!item) throw new Error('未知网页示例');
          const file = path.join(base, item.entry);
          let html = await readFile(file, 'utf8');
          const paths = new Set([...html.matchAll(/src="((?:images|img)\/[\w.-]+\.(?:webp|png))"/g)].map(match => match[1]));
          for (const src of paths) {
            const bytes = await readFile(path.join(path.dirname(file), src));
            html = html.replaceAll('src="' + src + '"', 'src="data:image/' + path.extname(src).slice(1) + ';base64,' + bytes.toString('base64') + '"');
          }
          return {html};
        }
        await queue;
        const state = await read(context);
        const works = state.works.map(work => {
          const row = {...summary(work), root:'work.read', entry:work.id};
          return {...row, next:nextOfWork(row,lang)};
        });
        const columns = new Map();
        for (const w of works) if (w.column) {
          const column = columns.get(w.column) || {name:w.column, issues:0, latest:w, next:nextIssue(w.column,w,lang)};
          column.issues++;
          columns.set(w.column,column);
        }
        return {version:'0.1.0', skills:skillsFor(lang), recipes:recipesFor(lang), examples:examples.map(e => ({
          ...e, example:true, files:(e.files || [e.entry]).map(f => '../examples/' + f),
          next:nextOfWork({...e,root:'examples'},lang)
        })), columns:[...columns.values()], works, voice:{exists:!!state.voice,text:state.voice,path:lang === 'en' ? 'Current workspace' : '当前工作区',prompts:{articles:voiceFor(lang).articles}}};
      }
      await queue;
      const state = await read(context);
      if (name === 'voice.show') return { text: state.voice };
      if (name === 'work.read') {
        const work = state.works.find(row => row.id === checkedId(args.id));
        if (work?.contentFile) {
          const file = await broker('data.read', [work.contentFile], context);
          if (!file) throw new Error('作品正文缺失');
          return {...summary(work), html:file.content};
        }
        if (work) return summary(work);
        throw new Error('作品不存在');
      }
      throw new Error('未知查询或技能');
    },
    execute(name, args, context) {
      const task = queue.then(() => execute(name, args, context));
      queue = task.catch(() => {});
      return task;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
