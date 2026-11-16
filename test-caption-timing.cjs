const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const worker = readFileSync('docs/asr-worker.js','utf8');
const context = vm.createContext({});
vm.runInContext(worker.slice(worker.indexOf('function groupWords'),worker.indexOf('self.onmessage')),context);
const group = chunks => JSON.parse(JSON.stringify(context.groupWords(chunks,40)));
assert.deepEqual(group([{text:'Hello.',timestamp:[2.42,3.1]},{text:'After silence',timestamp:[7.82,8.3]}]),[
 {start:2.42,end:3.1,text:'Hello.'},{start:7.82,end:8.3,text:'After silence'}]);
assert.deepEqual(group([{text:'invalid',timestamp:[null,2]},{text:'invalid',timestamp:[2,null]},{text:'zero',timestamp:[4,4]}]),[]);
assert.deepEqual(group([{text:'தமிழ்',timestamp:[1.2,1.8]},{text:'hello',timestamp:[1.9,2.3]}]),[{start:1.2,end:2.3,text:'தமிழ் hello'}]);
const words = Array.from({length:7},(_,i)=>({text:'word'+i,timestamp:[10+i*.4,10.2+i*.4]}));
const result=group(words);
assert.equal(result[1].start,words[5].timestamp[0]);
assert.ok(Math.abs(result[0].end-words[4].timestamp[1]) < .001);
assert.match(worker,/return_timestamps: 'word'/);
assert.ok(!worker.includes('alignToSpeech'));
console.log('PASS: actual word boundaries, silence gaps, Tamil text, invalid timestamps, grouping boundaries.');
