import test from 'node:test';
import assert from 'node:assert/strict';
import {beginPointerDrag,advancePointerDrag} from '../src/app/pointer-drag.mjs';
test('left drag ignores sub-threshold clicks then delivers full logical displacement',()=>{
 const event={pointerId:1,button:0,clientX:100,clientY:200};const d=beginPointerDrag(event,{x:20,y:40});
 assert.equal(advancePointerDrag(d,{...event,clientX:103},{x:21,y:40}),null);
 assert.deepEqual(advancePointerDrag(d,{...event,clientX:106},{x:22,y:40}),{x:2,y:0,pivot:{x:20,y:40}});
 assert.deepEqual(advancePointerDrag(d,{...event,clientX:109},{x:23,y:41}),{x:1,y:1,pivot:{x:22,y:40}});
});
test('right/middle drag remain immediate and unrelated pointers cannot move the camera',()=>{
 for(const button of [1,2]){const e={pointerId:2,button,clientX:10,clientY:10};const d=beginPointerDrag(e,{x:1,y:1});
 assert.equal(advancePointerDrag(d,{...e,pointerId:3},{x:2,y:2}),null);
 assert.deepEqual(advancePointerDrag(d,e,{x:2,y:2}),{x:1,y:1,pivot:{x:1,y:1}});}
});
