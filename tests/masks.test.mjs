import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoringTake, validateReference, normalizeMasks, applyMasks, maskedCells } from '../scoring.mjs';
import { parseMaskTime, formatMaskTime } from '../mask-editor.mjs';
const reference = masks => ({ version:1, videoId:'M7lc1UVf-VE', title:'Masks', step:.1, duration:10, frames:Array(100).fill(440), ...(masks ? {masks} : {}) });

test('masks default empty, merge overlapping or touching intervals and reject invalid ranges', () => {
  assert.deepEqual(validateReference(reference()).masks,[]);
  assert.deepEqual(normalizeMasks([{start:6,end:7},{start:2,end:4},{start:1,end:3},{start:4,end:5}],10),[{start:1,end:5},{start:6,end:7}]);
  for(const masks of [null,{},[{start:-1,end:2}],[{start:3,end:3}],[{start:4,end:2}],[{start:0,end:11}],[{start:NaN,end:2}],Array(101).fill({start:0,end:1})]) assert.throws(()=>normalizeMasks(masks,10));
  assert.equal(parseMaskTime('1:02.5'),62.5); assert.equal(parseMaskTime('32.5'),32.5);
  for(const invalid of ['', '-1','1:60','foo']) assert.throws(()=>parseMaskTime(invalid));
  assert.equal(formatMaskTime(62.5),'1:02.5');
});

test('multiple masks exclude wrong notes and silence from pitch, rhythm and coverage in every difficulty', () => {
  const ref=reference([{start:2,end:4},{start:6,end:8}]);
  for(const difficulty of ['strict','standard','relaxed']) for(const rangeMode of ['full','performed']) {
    const take=new ScoringTake(ref,{difficulty,rangeMode,allowOctave:true});
    take.begin(0);
    for(let i=0;i<100;i++)take.sample(i*.1+.01,i>=20&&i<40?659.25:i>=60&&i<80?null:220);
    assert.deepEqual(take.result(),{score:100,pitch:100,rhythm:100,coverage:100,referenceSeconds:6,sampledSeconds:6});
    assert.equal(take.observations.has(20),false);
  }
  assert.ok(ref.frames.every(hz=>hz===440));
  assert.equal(applyMasks(ref).frames[20],null);
});

test('mask boundaries are start-inclusive, end-exclusive; active takes snapshot metadata', () => {
  const ref=reference([{start:2,end:3}]);
  const cells=maskedCells(ref);
  assert.equal(cells[19],false); assert.equal(cells[20],true); assert.equal(cells[29],true); assert.equal(cells[30],false);
  const partial=maskedCells(reference([{start:2.05,end:2.15}]));
  assert.equal(partial[20],true);assert.equal(partial[21],true);assert.equal(partial[22],false);
  const take=new ScoringTake(ref);ref.masks[0].end=10;ref.masks.length=0;
  assert.equal(take.result().referenceSeconds,9);
  assert.equal(new ScoringTake(ref).result().referenceSeconds,10);
});

test('all-masked and mask-only performed sections produce no score; unmasked silence still loses points', () => {
  const all=new ScoringTake(reference([{start:0,end:10}]));
  for(let i=0;i<100;i++)all.sample(i*.1+.01,440);
  assert.equal(all.result().score,null);
  const partial=new ScoringTake(reference([{start:0,end:2},{start:4,end:6}]),{rangeMode:'performed'});
  partial.begin(0);partial.advance(2);assert.equal(partial.result().score,null);
  for(let i=20;i<40;i++)partial.sample(i*.1+.01,440);
  partial.advance(6);assert.equal(partial.result().score,100);assert.equal(partial.result().referenceSeconds,2);
  partial.advance(8);assert.equal(partial.result().coverage,50);assert.equal(partial.result().pitch,50);
});

test('timing matching cannot borrow an onset from across a masked interval', () => {
  const ref=reference([{start:2.2,end:2.4}]);ref.frames.fill(null,0,20);
  const take=new ScoringTake(ref,{difficulty:'relaxed'});
  // Miss the note before the mask, sing the continuation after it precisely.
  for(let i=24;i<100;i++)take.sample(i*.1+.01,440);
  assert.equal(take.result().rhythm,50);
});
