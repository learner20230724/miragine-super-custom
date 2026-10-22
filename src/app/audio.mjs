/** Browser media adapter. Original audio bytes are resolved solely through the manifest. */
export class GameAudio {
  constructor(manifest, { audioFactory = url => new Audio(url),
    now = () => performance.now(), requestFrame = callback => requestAnimationFrame(callback) } = {}) {
    this.manifest = manifest;
    this.music = null;
    this.trackName = null;
    this.loop = true;
    this.unlocked = false;
    this.muted = false;
    this.effects = new Set();
    this.audioFactory = audioFactory;
    this.now = now;
    this.requestFrame = requestFrame;
    this.musicTicket = 0;
    this.pendingOptions = {};
  }
  url(name) { return this.manifest.sounds[name]?.file; }
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.trackName) this.playMusic(this.trackName, this.loop, this.pendingOptions);
  }
  setMuted(value) {
    this.muted = value;
    if (this.music) this.music.muted = value;
    for (const effect of this.effects) effect.muted = value;
  }
  fade(track, target, duration, ticket, complete = () => {}) {
    const started = this.now(), from = track.volume;
    const frame = now => {
      if (ticket !== this.musicTicket) return;
      const ratio = Math.max(0, Math.min(1, (now - started) / duration));
      const eased = 1 - (1 - ratio) ** 2; // recovered TweenLite.defaultEase
      track.volume = Math.max(0, Math.min(1, from + (target - from) * eased));
      if (ratio < 1) this.requestFrame(frame);
      else complete();
    };
    this.requestFrame(frame);
  }
  playMusic(name, loop = true, { fadeOutMs = 0, fadeInMs = 0, repeats = 0 } = {}) {
    this.trackName = name;
    this.loop = loop;
    this.pendingOptions = { fadeOutMs, fadeInMs, repeats };
    if (!this.unlocked) return;
    const url = this.url(name);
    if (!url) throw new Error(`Missing original audio: ${name}`);
    const ticket = ++this.musicTicket, old = this.music;
    const begin = () => {
      if (ticket !== this.musicTicket) return;
      old?.pause();
      const track = this.audioFactory(url);
      this.music = track;
      track.loop = loop;
      track.muted = this.muted;
      track.volume = fadeInMs > 0 ? 0 : 1;
      if (!loop && repeats > 0) {
        track.addEventListener('ended', () => {
          if (ticket === this.musicTicket && repeats-- > 0) {
            track.currentTime = 0;
            track.play().catch(() => {});
          }
        });
      }
      track.play().catch(() => { /* Browser autoplay policy is not a game-rule change. */ });
      if (fadeInMs > 0) this.fade(track, 1, fadeInMs, ticket);
    };
    if (old && fadeOutMs > 0) this.fade(old, 0, fadeOutMs, ticket, begin);
    else begin();
  }
  consume(events) {
    for (const event of events) {
      if (event.type === 'music') { this.playMusic(event.name, event.loop !== false, event); continue; }
      if (event.type !== 'sound' || !this.unlocked || this.muted) continue;
      const url = this.url(event.name);
      if (!url) throw new Error(`Missing original audio: ${event.name}`);
      const sound = this.audioFactory(url);
      sound.volume = Math.max(0, Math.min(1, event.volume ?? 1));
      this.effects.add(sound);
      sound.addEventListener('ended', () => this.effects.delete(sound), { once: true });
      sound.addEventListener('error', () => this.effects.delete(sound), { once: true });
      sound.play().catch(() => this.effects.delete(sound));
    }
  }
}
