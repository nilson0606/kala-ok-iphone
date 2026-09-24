import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingTuningSuffix} from '../recording-tune.mjs';
test('retired effect keeps legacy recording labels and download names without marking new recordings',()=>{
  assert.equal(recordingTuningSuffix({}),'');
  assert.equal(recordingTuningSuffix({vocalTuning:{strength:'off'}}),'');
  assert.equal(recordingTuningSuffix({vocalTuning:{strength:'invalid'}}),'');
  assert.equal(recordingTuningSuffix({vocalTuning:{version:1,strength:'light'}}),'_修音輕度');
  assert.equal(recordingTuningSuffix({vocalTuning:{version:2,strength:'strong'}}),'_修音強烈');
  assert.equal(recordingTuningSuffix({vocalTuning:{version:3,strength:'strong'}}),'_合成器強烈');
});
