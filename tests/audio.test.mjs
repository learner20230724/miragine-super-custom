import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, MAX_CONCURRENT_EFFECTS, EFFECT_COALESCE_MS } from '../src/app/audio.mjs';

function fixture({ failPlay = null } = {}) {
  let now = 0;
  const tracks = [];
  const manifest = { sounds: Object.fromEntries(['hit', 'death', 'SD_btns', 'music'].map(name => [name, { file: `${name}.mp3` }])) };
  const audio = new GameAudio(manifest, {
    now: () => now,
    requestFrame: () => {},
    audioFactory(url) {
      const listeners = new Map();
      const track = {
        url, volume: 1, playbackRate: 1, muted: false, paused: false, ended: false, duration: NaN,
        listeners,
        play() {
          if (failPlay === 'throw') throw new Error('play failed');
          return failPlay === 'reject' ? Promise.reject(new Error('play rejected')) : Promise.resolve();
        },
        pause() { this.paused = true; },
        addEventListener(type, listener) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
        emit(type) { for (const listener of [...listeners.get(type) ?? []]) listener(); },
      };
      tracks.push(track);
      return track;
    },
  });
  audio.unlock();
  return { audio, tracks, setNow(value) { now = value; } };
}

const sound = (name = 'hit', volume = 1) => ({ type: 'sound', name, volume });
const listenersLeft = track => [...track.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);

test('same-name sounds in a large simulation batch coalesce to the maximum volume without changing events', () => {
  const { audio, tracks } = fixture();
  const events = Object.freeze(Array.from({ length: 600 }, (_, index) => Object.freeze(sound('hit', index % 2 ? .2 : .8))));
  const before = JSON.stringify(events);
  audio.consume(events);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].volume, .8);
  assert.equal(JSON.stringify(events), before);
  assert.equal(audio.effects.size, 1);
});

test('combat effects use a brief wall-time duplicate window, while separate UI clicks remain audible', () => {
  const { audio, tracks, setNow } = fixture();
  audio.consume([sound()]);
  setNow(EFFECT_COALESCE_MS - 1);
  audio.consume([sound()]);
  assert.equal(tracks.length, 1);
  setNow(EFFECT_COALESCE_MS);
  audio.consume([sound()]);
  audio.consume([sound('SD_btns')]);
  audio.consume([sound('SD_btns')]);
  assert.equal(tracks.length, 4);
  assert.deepEqual(tracks.slice(2).map(track => track.url), ['SD_btns.mp3', 'SD_btns.mp3']);
});

test('accelerated combat cannot exceed 32 concurrent effects or queue blocked sounds for later', () => {
  const { audio, tracks, setNow } = fixture();
  for (let frame = 0; frame < 120; frame++) {
    setNow(frame * EFFECT_COALESCE_MS);
    audio.consume(Array.from({ length: 600 }, () => sound()));
    assert.ok(audio.effects.size <= MAX_CONCURRENT_EFFECTS);
  }
  assert.equal(tracks.length, 32);
  assert.equal(audio.effects.size, 32);
  tracks[0].emit('ended');
  audio.consume([]);
  assert.equal(audio.effects.size, 31, 'dropped effects are not queued');
  audio.consume([sound()]);
  assert.equal(tracks.length, 33);
  assert.equal(audio.effects.size, 32);
});

test('a UI click preempts the oldest combat sound when the bounded pool is full', () => {
  const { audio, tracks, setNow } = fixture();
  for (let index = 0; index < MAX_CONCURRENT_EFFECTS; index++) {
    setNow(index * EFFECT_COALESCE_MS);
    audio.consume([sound()]);
  }
  audio.consume([sound('SD_btns')]);
  assert.equal(tracks.length, 33);
  assert.equal(audio.effects.size, 32);
  assert.equal(tracks[0].paused, true);
  assert.equal(listenersLeft(tracks[0]), 0);
  assert.equal(tracks.at(-1).url, 'SD_btns.mp3');
  assert.equal(tracks.at(-1).paused, false);
});

test('even an all-UI pool stays bounded and admits the latest click', () => {
  const { audio, tracks } = fixture();
  for (let index = 0; index < 50; index++) audio.consume([sound('SD_btns')]);
  assert.equal(tracks.length, 50);
  assert.equal(audio.effects.size, 32);
  assert.equal(tracks.filter(track => track.paused).length, 18);
  assert.equal(tracks.at(-1).paused, false);
});

test('ended and error release both event listeners and all active-effect references', () => {
  const { audio, tracks } = fixture();
  audio.consume([sound(), sound('death')]);
  tracks[0].emit('ended');
  tracks[1].emit('error');
  assert.equal(audio.effects.size, 0);
  assert.equal(audio.effectDetails.size, 0);
  assert.deepEqual(tracks.map(listenersLeft), [0, 0]);
  assert.equal(tracks[1].paused, true);
});

test('rejected or synchronously failed playback releases effects without interrupting the game', async () => {
  for (const failPlay of ['reject', 'throw']) {
    const { audio, tracks } = fixture({ failPlay });
    assert.doesNotThrow(() => audio.consume([sound()]));
    await Promise.resolve();
    assert.equal(audio.effects.size, 0);
    assert.equal(audio.effectDetails.size, 0);
    assert.equal(listenersLeft(tracks[0]), 0);
    assert.equal(tracks[0].paused, true);
  }
});

test('stalled media are reaped on empty consumes, but valid long clips retain their full duration', () => {
  const { audio, tracks, setNow } = fixture();
  audio.consume([sound(), sound('death')]);
  tracks[1].duration = 60;
  setNow(30_001);
  audio.consume([]);
  assert.equal(audio.effects.size, 1);
  assert.equal(tracks[0].paused, true);
  assert.equal(tracks[1].paused, false);
  setNow(61_001);
  audio.consume([]);
  assert.equal(audio.effects.size, 0);
  assert.equal(tracks[1].paused, true);
});

test('an already-ended track without an ended event is also reaped', () => {
  const { audio, tracks } = fixture();
  audio.consume([sound()]);
  tracks[0].ended = true;
  audio.consume([]);
  assert.equal(audio.effects.size, 0);
  assert.equal(listenersLeft(tracks[0]), 0);
});

test('pauseEffects stops effects and clears dedup state without pausing or retiming music', () => {
  const { audio, tracks } = fixture();
  audio.playMusic('music');
  audio.consume([sound(), sound('death')]);
  audio.pauseEffects();
  audio.pauseEffects();
  assert.equal(audio.effects.size, 0);
  assert.equal(audio.effectDetails.size, 0);
  assert.equal(audio.recentEffects.size, 0);
  assert.equal(tracks[0].paused, false);
  assert.deepEqual(tracks.map(track => track.playbackRate), [1, 1, 1]);
  assert.deepEqual(tracks.slice(1).map(track => track.paused), [true, true]);
  assert.deepEqual(tracks.slice(1).map(listenersLeft), [0, 0]);
  audio.consume([sound()]);
  assert.equal(tracks.length, 4, 'resuming may immediately play a new effect');
});

test('mute, unknown effect validation, and volume clamping remain supported', () => {
  const { audio, tracks, setNow } = fixture();
  audio.consume([sound('hit', 99), sound('death', -1)]);
  assert.deepEqual(tracks.map(track => track.volume), [1, 0]);
  audio.setMuted(true);
  assert.ok(tracks.every(track => track.muted));
  audio.consume([sound('SD_btns')]);
  assert.equal(tracks.length, 2);
  audio.setMuted(false);
  setNow(EFFECT_COALESCE_MS);
  assert.throws(() => audio.consume([sound('missing')]), /Missing original audio: missing/);
  audio.consume([sound('hit', NaN)]);
  assert.equal(tracks.at(-1).volume, 1);
});
