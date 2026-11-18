import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDomainRuntime} from '../guizang-design/domain.mjs';

const repo = fileURLToPath(new URL('../',import.meta.url));
const pkg = path.join(repo,'guizang-design');
const manifest = JSON.parse(await fs.readFile(path.join(pkg, 'extension.json'), 'utf8'));
assert.equal(manifest.agent.skills.length, 5);
for (const skill of manifest.agent.skills) assert.match(await fs.readFile(path.join(pkg, skill), 'utf8'), /description:/);
const files = new Map();
const broker = async (method,[key,value]) => {
  if (method === 'data.read') return files.has(key) ? {content:files.get(key)} : null;
  assert.equal(method,'data.write'); files.set(key,value);
};
const open = () => createDomainRuntime({broker,identity:{},packageRoot:pkg});
const runtime = open();
for (const lang of ['zh','en']) {
  const catalog = await runtime.query('catalog',{lang});
  assert.equal(catalog.skills.length,4); assert.equal(catalog.recipes.length,6);
  assert.equal(catalog.examples.length,6);
  const example = await runtime.query('example.html',{lang,id:'ppt-magazine'});
  assert.match(example.html,/src="data:image\//);
  assert.doesNotMatch(example.html,/src="images\//);
}
const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'guizang-render-'));
try {
  const loc = await runtime.query('skill.location',{skill:'guizang-page-skill'});
  await fs.writeFile(path.join(tmp,'input.md'),'# Test\n\nA real rendering test.');
  await fs.writeFile(path.join(tmp,'meta.json'),JSON.stringify({meta:{title:'Test',subtitle:'',tags:[],author:'Test',date:'2026',reading_time:'1 min'},upgrades:[]}));
  execFileSync(process.execPath,[path.join(loc.skillRoot,'scripts/render.mjs'),'input.md','meta.json','page.html'],{cwd:tmp});
  const html = await fs.readFile(path.join(tmp,'page.html'),'utf8');
  assert.match(html,/A real rendering test/);
  await runtime.execute('work.save',{id:'one',title:'Test',skill:'guizang-page-skill',html,column:'Series'},{actor:'agent'});
  await runtime.execute('voice.save',{text:'# Voice'},{actor:'agent'});
  const reopened = open();
  assert.equal((await reopened.query('work.read',{id:'one'})).html,html);
  assert.equal((await reopened.query('catalog',{lang:'en'})).columns[0].issues,1);
  assert.equal((await reopened.query('voice.show',{})).text,'# Voice');
  const projectWork = {id:'deck',title:'Deck',skill:'guizang-ppt-skill',relativePath:'作品/deck.html'};
  await reopened.execute('work.save',projectWork,{actor:'agent',sessionId:'first',taskRef:'sidebar:stable'});
  assert.equal((await open().query('catalog',{})).works[0].taskRef,'sidebar:stable');
  await reopened.execute('work.save',projectWork,{actor:'agent',sessionId:'old'});
  const relink = {id:'deck',previousSessionId:'old'};
  await assert.rejects(()=>reopened.execute('work.relink',relink,{actor:'agent',taskRef:'sidebar:stable'}));
  await reopened.execute('work.relink',relink,{actor:'human',taskRef:'sidebar:stable'});
  assert.equal((await open().query('catalog',{})).works[0].taskRef,'sidebar:stable');
  await reopened.execute('work.remove',{id:'deck'},{actor:'human'});
  await reopened.execute('work.remove',{id:'one'},{actor:'human'});
  assert.equal((await reopened.getSnapshot()).state.works.length,0);
} finally { await fs.rm(tmp,{recursive:true,force:true}); }
console.log('Guizang package, five skill mounts, localized catalogs, sample exports, renderer and domain round trip passed.');
