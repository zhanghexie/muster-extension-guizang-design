import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const gallery = path.resolve('guizang-design/gallery');
const load = (file: string) => readFileSync(path.join(gallery, file), 'utf8');
let cleanup: AbortController;

beforeEach(() => {
  cleanup = new AbortController();
  const onDocument = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) =>
    onDocument(type, listener, { ...(typeof options === 'object' ? options : {}), signal: cleanup.signal }));
  const onWindow = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) =>
    onWindow(type, listener, { ...(typeof options === 'object' ? options : {}), signal: cleanup.signal }));
});
afterEach(() => { cleanup.abort(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('opens an editable workflow draft without starting a model turn', async () => {
  document.body.innerHTML = new DOMParser().parseFromString(load('panel.html'), 'text/html').body.innerHTML;
  location.hash = '/workflows';
  const query = vi.fn().mockResolvedValue({skills:[],recipes:[{id:'page',title:'排版',steps:[],prompt:'请排版：'}],works:[],examples:[],columns:[],voice:{}});
  const send = vi.fn(), create = vi.fn();
  vi.stubGlobal('ma', {ready:Promise.resolve({}),context:()=>({appearance:{locale:'zh-CN'}}),on:vi.fn(),tasks:{create},agent:{domain:{query},send}});
  vi.stubGlobal('matchMedia', () => ({matches:true}));
  vi.stubGlobal('scrollTo', vi.fn());
  window.eval(load('i18n.js'));
  window.eval(load('app.js'));
  await vi.waitFor(() => expect(document.querySelector('[data-recipe]')).toBeTruthy());
  document.querySelector<HTMLButtonElement>('[data-recipe]')!.click();
  await vi.waitFor(() => expect(create).toHaveBeenCalledWith('排版','请排版：'));
  expect(send).not.toHaveBeenCalled();
});

it('opens an HTML example through the host export preview', async () => {
  document.body.innerHTML = new DOMParser().parseFromString(load('panel.html'), 'text/html').body.innerHTML;
  location.hash = '/examples';
  const query = vi.fn(async (name: string) => name === 'example.html' ? {html:'<h1>Deck</h1>'} : {
    skills:[], recipes:[], works:[], columns:[], voice:{},
    examples:[{id:'slide', title:'Deck', kind:'html', example:true, skill:'guizang-ppt-skill'}]
  });
  const preview = vi.fn().mockResolvedValue({ok:true});
  const create = vi.fn().mockResolvedValue({exportId:'sample'});
  vi.stubGlobal('ma', {ready:Promise.resolve({}),context:()=>({appearance:{locale:'zh-CN'}}),on:vi.fn(),agent:{domain:{query}},exports:{create,preview}});
  vi.stubGlobal('matchMedia', () => ({matches:true}));
  vi.stubGlobal('scrollTo', vi.fn());
  window.eval(load('i18n.js'));
  window.eval(load('app.js'));
  await vi.waitFor(() => expect(document.querySelector('[data-open="slide"]')).toBeTruthy());
  document.querySelector<HTMLElement>('[data-open="slide"]')!.click();
  await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('sample','index.html'));
  expect(create).toHaveBeenCalledWith([{name:'index.html',text:'<h1>Deck</h1>'}],'Deck');
});


it('loads real thumbnails for existing project and legacy HTML works', async () => {
  document.body.innerHTML = new DOMParser().parseFromString(load('panel.html'), 'text/html').body.innerHTML;
  location.hash = '/works';
  const rows = [
    { id: 'legacy', title: '归档', kind: 'html' },
    { id: 'project', title: '项目作品', kind: 'project', relativePath: '作品/首页.html', sessionId: 'task-a' }
  ];
  const catalog = { skills: [], recipes: [], columns: [], examples: [], works: rows, voice: {} };
  const query = vi.fn(async (name: string) => name === 'work.read' ? { html: '<main>归档</main>' } : catalog);
  const thumb = { dataUrl: 'data:image/png;base64,AAAA' };
  const thumbnail = vi.fn().mockResolvedValue(thumb);
  const thumbnailHtml = vi.fn().mockResolvedValue(thumb);
  vi.stubGlobal('matchMedia', () => ({matches:true}));
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('ma', {ready:Promise.resolve({}),context:()=>({appearance:{locale:'zh-CN'}}),on:vi.fn(),
    tasks:{thumbnail},exports:{thumbnailHtml},agent:{domain:{query}}});
  vi.stubGlobal('scrollTo', vi.fn());
  window.eval(load('i18n.js'));
  window.eval(load('app.js'));
  await vi.waitFor(() => expect(document.querySelectorAll('.work-preview img')).toHaveLength(2));
  expect(thumbnail).toHaveBeenCalledWith('task-a', '作品/首页.html');
  expect(thumbnailHtml).toHaveBeenCalledWith('<main>归档</main>');
  expect(document.querySelector('.work-preview img')?.getAttribute('src')).toBe(thumb.dataUrl);
});
it('removes a library work only after host confirmation', async () => {
  document.body.innerHTML = new DOMParser().parseFromString(load('panel.html'), 'text/html').body.innerHTML;
  location.hash = '/works';
  const query = vi.fn().mockResolvedValue({skills:[],recipes:[],works:[{id:'work',title:'Work',kind:'html',skill:'guizang-ppt-skill'}],examples:[],columns:[],voice:{}});
  const command = vi.fn().mockResolvedValue({ok:true});
  const confirm = vi.fn().mockResolvedValue(false);
  vi.stubGlobal('ma', {ready:Promise.resolve({}),context:()=>({appearance:{locale:'en'}}),on:vi.fn(),ui:{confirm},agent:{domain:{query,command}}});
  vi.stubGlobal('matchMedia', () => ({matches:true}));
  vi.stubGlobal('scrollTo', vi.fn());
  window.eval(load('i18n.js'));
  window.eval(load('app.js'));
  await vi.waitFor(() => expect(document.querySelector('[data-remove]')).toBeTruthy());
  document.querySelector<HTMLButtonElement>('[data-remove]')!.click();
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(command).not.toHaveBeenCalled();
  confirm.mockResolvedValue(true);
  document.querySelector<HTMLButtonElement>('[data-remove]')!.click();
  await vi.waitFor(() => expect(command).toHaveBeenCalledWith('work.remove', {id:'work'}));
});

it('reconnects a missing legacy session only after confirmation and a successful project preview', async () => {
  document.body.innerHTML = new DOMParser().parseFromString(load('panel.html'), 'text/html').body.innerHTML;
  location.hash = '/works';
  const work = { id:'deck', title:'Deck', kind:'project', sessionId:'old', relativePath:'works/deck.html' };
  const query = vi.fn().mockResolvedValue({skills:[],recipes:[],works:[work],columns:[],examples:[],voice:{}});
  const command = vi.fn(), confirm = vi.fn().mockResolvedValue(false);
  const preview = vi.fn(async (target: string) => { if (target === 'old') throw Error('TASK_SESSION_MISSING'); });
  vi.stubGlobal('ma',{ready:Promise.resolve({}),context:()=>({}),on:vi.fn(),ui:{confirm},
    tasks:{preview,thumbnail:vi.fn()},agent:{open:async()=>({sessionId:'new'}),domain:{query,command}}});
  vi.stubGlobal('matchMedia',()=>({matches:true}));
  vi.stubGlobal('scrollTo',vi.fn());
  window.eval(load('i18n.js'));
  window.eval(load('app.js'));
  await vi.waitFor(()=>expect(document.querySelector('[data-open="deck"]')).toBeTruthy());
  const click = () => document.querySelector<HTMLAnchorElement>('[data-open="deck"]')!.click();
  click();
  await vi.waitFor(()=>expect(confirm).toHaveBeenCalledOnce());
  expect(command).not.toHaveBeenCalled();
  confirm.mockResolvedValue(true);
  click();
  await vi.waitFor(()=>expect(command).toHaveBeenCalledWith('work.relink',{id:'deck',previousSessionId:'old'}));
  expect(preview).toHaveBeenCalledWith('new','works/deck.html');
});
