#!/usr/bin/env node
// Integration tests operate exclusively on temporary repositories and a local bare remote.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {scan,clean}=require('../dist-electron/repos.js');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sweep-clean-worktree-'));
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const opts={forceFetch:false,scanMinutes:1440,showRemoteBranches:false,openMRsByProject:new Map()};
const inspect=repo=>scan(repo,root,opts);
try {
  const remote=path.join(root,'origin.git');
  git(root,'init','--bare','-b','main',remote);
  const primary=path.join(root,'primary');git(root,'clone',remote,primary);
  git(primary,'config','user.name','Fixture');git(primary,'config','user.email','fixture@example.test');
  fs.writeFileSync(path.join(primary,'file.txt'),'base\n');git(primary,'add','.');git(primary,'commit','-m','initial');git(primary,'push','-u','origin','main');
  const linked=path.join(root,'linked with spaces');git(primary,'worktree','add','-b','feature/in-use',linked);
  git(primary,'branch','unused');
  fs.writeFileSync(path.join(primary,'file.txt'),'primary edits\n');
  fs.writeFileSync(path.join(linked,'file.txt'),'linked edits\n');
  const mainBefore=git(primary,'rev-parse','HEAD');const linkedBefore=git(linked,'rev-parse','HEAD');
  const a=await inspect(primary);const b=await inspect(linked);
  assert.deepEqual(a.cleanupBranches,['unused']);assert.deepEqual(a.protectedCleanupBranches,['feature/in-use']);
  assert.deepEqual(b.cleanupBranches,['unused']);assert.deepEqual(b.protectedCleanupBranches,['feature/in-use']);assert.equal(b.cleanupPrimaryElsewhere,true);
  assert.equal(await clean(b),null,'linked cleanup must succeed without checking out main');
  assert.equal(git(primary,'branch','--list','unused'),'');
  assert.equal(git(linked,'branch','--show-current'),'feature/in-use');
  assert.equal(git(primary,'rev-parse','HEAD'),mainBefore);assert.equal(git(linked,'rev-parse','HEAD'),linkedBefore);
  assert.equal(fs.readFileSync(path.join(primary,'file.txt'),'utf8'),'primary edits\n');assert.equal(fs.readFileSync(path.join(linked,'file.txt'),'utf8'),'linked edits\n');
  assert.equal(await clean(a),null,'second queued worktree cleanup must tolerate already-deleted shared refs');
  console.log('PASS: shared refs, primary ownership, dirty worktrees, and stale queued cleanup');

  git(primary,'branch','claimed-after-scan');const stale=await inspect(primary);
  const third=path.join(root,'third');git(primary,'worktree','add',third,'claimed-after-scan');
  assert.equal(await clean(stale),null);assert.equal(git(third,'branch','--show-current'),'claimed-after-scan');
  console.log('PASS: branch claimed by another worktree after scan is retained');

  git(primary,'branch','confirmed-unused');const confirmed=await inspect(primary);git(primary,'branch','new-after-confirmation');
  assert.equal(await clean(confirmed),null);assert.equal(git(primary,'branch','--list','confirmed-unused'),'');assert.ok(git(primary,'branch','--list','new-after-confirmation'));
  console.log('PASS: new unconfirmed branches are retained');

  const standalone=path.join(root,'standalone');git(root,'clone',remote,standalone);git(standalone,'checkout','-b','feature/local');
  const normal=await inspect(standalone);assert.ok(normal.cleanupBranches.includes('feature/local'));
  assert.equal(await clean(normal),null);assert.equal(git(standalone,'branch','--show-current'),'main');assert.equal(git(standalone,'branch','--list','feature/local'),'');
  console.log('PASS: normal clone still switches to main and cleans its previous local branch');

  git(standalone,'branch','needs-clean');const failing=await inspect(standalone);git(standalone,'remote','set-url','origin',path.join(root,'missing.git'));
  assert.match(await clean(failing),/pull failed:/);
  console.log('PASS: pull failures are reported instead of a false success');
} finally {fs.rmSync(root,{recursive:true,force:true});}
