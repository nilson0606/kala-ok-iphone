import test from 'node:test';
import assert from 'node:assert/strict';
import { updateSeparation } from '../local-jobs.mjs';
test('GPU progress resets on CPU fallback and keeps the fallback explanation', () => {
 const job = {};
 updateSeparation(job, {device:'cuda', deviceName:'Test GPU',progress:0});
 updateSeparation(job, {progress:75});
 assert.equal(job.progress,75); assert.equal(job.device,'cuda');
 updateSeparation(job, {device:'cpu', deviceName:'CPU',fallback:true,progress:0});
 assert.equal(job.progress,0); assert.equal(job.device,'cpu');
 updateSeparation(job, {progress:30});
 assert.equal(job.progress,30); assert.equal(job.fallback,true);
 assert.match(job.message,/GPU.*CPU/);
 updateSeparation(job, {progress:20}); assert.equal(job.progress,30);
});

test('lead stage starts a new progress range after Demucs completes', () => {
 const job = {};
 updateSeparation(job,{stage:'separating',device:'cuda',progress:100});
 updateSeparation(job,{stage:'lead_separating',device:'cuda',progress:0});
 assert.equal(job.progress,0); assert.match(job.message,/主唱與和音/);
 updateSeparation(job,{stage:'lead_separating',progress:20});
 assert.equal(job.progress,20);
});
