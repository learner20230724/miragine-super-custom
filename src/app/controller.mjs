import { MiragineSimulation } from '../core/index.mjs';

/** Native controller ported from the recovered MainTimeline/homebtns/tutorial/quitgame classes. */
export class GameController {
  constructor(config, { createSimulation = options => new MiragineSimulation(options), storage = null } = {}) {
    this.config = config;
    this.createSimulation = createSimulation;
    this.storage = storage;
    this.phase = 'title';
    this.panel = 'home';
    this.overlay = null;
    this.underOverlay = null;
    this.singlePlay = true;
    this.difficulty = 1;
    this.simulation = null;
    this.muted = false;
    this.events = [];
    this.winDeadline = null;
    this.winStarted = null;
    this.cursorPresentation = { left: { scale: 1, alpha: 1 }, right: { scale: 1, alpha: 1 } };
    this.revision = 0;
  }

  neverTutorial() {
    try { return this.storage?.getItem('miraginewar.never') === 'true'; } catch { return false; }
  }

  startMatch(singlePlay = this.singlePlay, difficulty = this.difficulty) {
    this.simulation?.stop();
    this.singlePlay = !!singlePlay;
    this.difficulty = difficulty;
    this.simulation = this.createSimulation({ config: this.config, singlePlay: this.singlePlay, difficulty });
    this.phase = 'game';
    this.overlay = this.neverTutorial() ? null : 'tutorial';
    this.underOverlay = null;
    if (this.overlay === 'tutorial') this.simulation.stopTimer = true;
    this.winDeadline = null;
    this.winStarted = null;
    this.cursorPresentation = { left: { scale: 1, alpha: 1 }, right: { scale: 1, alpha: 1 } };
    this.events.push({ type: 'music', name: 'gameLoop', fadeOutMs: 2000, fadeInMs: 2000 });
    this.revision++;
  }

  action(name, value) {
    if (name === 'music') {
      this.muted = !this.muted;
      this.revision++;
      return true;
    }
    if (this.phase === 'title') {
      if (this.overlay === 'credits') {
        if (name !== 'credits-back') return false;
        this.overlay = null;
      } else if (name === 'single') {
        this.singlePlay = true;
        this.panel = 'difficulty';
      } else if (name === 'dual') {
        this.startMatch(false, this.difficulty);
      } else if (name === 'credits') {
        this.overlay = 'credits';
      } else if (name === 'back') {
        this.panel = 'home';
      } else if (name === 'difficulty' && Number.isInteger(value) && value >= 0 && value < 4) {
        this.startMatch(true, value);
      } else return false;
    } else if (this.phase === 'game') {
      const tutorialVisible = this.overlay === 'tutorial' || this.underOverlay === 'tutorial';
      if (name === 'quit') {
        this.underOverlay = tutorialVisible ? 'tutorial' : null;
        this.overlay = 'quit';
      } else if (name === 'tutorial-okay' || name === 'tutorial-never') {
        if (!tutorialVisible) return false;
        if (name === 'tutorial-never') {
          try { this.storage?.setItem('miraginewar.never', 'true'); } catch { /* Storage may be disabled. */ }
        }
        this.simulation.stopTimer = false;
        if (this.overlay === 'tutorial') this.overlay = null;
        else this.underOverlay = null;
      } else if (name === 'quit-cancel' && this.overlay === 'quit') {
        this.overlay = this.underOverlay;
        this.underOverlay = null;
      } else if (name === 'quit-confirm' && this.overlay === 'quit') {
        this.home();
      } else if (name === 'tutorial') {
        // Original manual help button only makes the panel visible; it does NOT pause round time.
        if (this.overlay === 'quit') this.underOverlay = 'tutorial';
        else this.overlay = 'tutorial';
      } else if (name === 'result' && this.simulation.winner) {
        this.showResult();
      } else return false;
    } else if (this.phase === 'over') {
      if (name === 'replay') this.startMatch();
      else if (name === 'home') this.home();
      else return false;
    } else return false;
    this.events.push({ type: 'sound', name: 'SD_btns', volume: 1 });
    this.revision++;
    return true;
  }

  home() {
    this.simulation?.stop();
    this.phase = 'title';
    this.panel = 'home';
    this.overlay = null;
    this.underOverlay = null;
    this.winDeadline = null;
    this.winStarted = null;
    this.events.push({ type: 'music', name: 'mainLoop' });
    this.revision++;
  }

  showResult() {
    this.phase = 'over';
    this.overlay = null;
    this.underOverlay = null;
    this.winDeadline = null;
    this.winStarted = null;
    this.events.push({ type: 'music', name: this.simulation.winner === 'left' ? 'sd_win' : 'sd_lose', loop: false, fadeInMs: 1000, repeats: 1 });
    this.revision++;
  }

  tick(now) {
    if (this.phase !== 'game') return;
    const beforeFrame = this.simulation.frame;
    this.simulation.step();
    const events = this.simulation.drainEvents();
    this.events.push(...events);
    if (this.simulation.frame !== beforeFrame) {
      for (const event of events) {
        if (event.type === 'recruit') this.cursorPresentation[event.side] = { scale: 1.4, alpha: 1 };
      }
      // DragonForce.createUnit and the end of DragonForce.step. Preserve the
      // original floating-point decrement, including its slight <1 endpoint.
      for (const pulse of Object.values(this.cursorPresentation)) {
        if (pulse.scale > 1) { pulse.scale -= .1; pulse.alpha -= .05; }
      }
    }
    if (this.simulation.winner && this.winDeadline === null) {
      // MainTimeline: .3 s delay + .6 s tween, followed by a 2 s timeout.
      this.winDeadline = now + 2900;
      this.winStarted = now;
      this.revision++;
    }
    if (this.winDeadline !== null && now >= this.winDeadline) this.showResult();
  }

  select(side, id) {
    if (this.phase !== 'game' || this.simulation.winner) return false;
    if (side === 'right' && this.singlePlay) return false;
    this.simulation.selectUnit(side, id);
    return true;
  }

  key(code) {
    if (code === 'Escape' && this.phase === 'game') return this.action('quit');
    if (this.phase !== 'game' || this.simulation.winner) return false;
    const keys = {
      KeyW: ['left', 0, -1, 0], KeyS: ['left', 0, 1, 0],
      KeyA: ['left', -1, 0, 0], KeyD: ['left', 1, 0, 0], Space: ['left', 0, 0, 1],
      ArrowUp: ['right', 0, -1, 0], ArrowDown: ['right', 0, 1, 0],
      ArrowLeft: ['right', -1, 0, 0], ArrowRight: ['right', 1, 0, 0], Enter: ['right', 0, 0, 1],
    };
    if (keys[code]) {
      const [side, ...args] = keys[code];
      if (side === 'right' && this.singlePlay) return false;
      this.simulation.control(side, ...args);
      return true;
    }
    if (code === 'Equal' || code === 'NumpadAdd') this.simulation.destroyUnits(0.02);
    else if (code === 'Minus' || code === 'NumpadSubtract') this.simulation.destroyUnits(-0.02);
    else return false;
    return true;
  }

  drainEvents() { return this.events.splice(0); }

  snapshot() {
    const sim = this.simulation;
    return {
      phase: this.phase, panel: this.panel, overlay: this.overlay, underOverlay: this.underOverlay, singlePlay: this.singlePlay,
      difficulty: this.difficulty, muted: this.muted, winner: sim?.winner ?? null,
      frame: sim?.frame ?? 0, round: sim?.round ?? null, running: sim?.running ?? false,
      stopTimer: sim?.stopTimer ?? false,
      selection: sim ? { left: [...sim.p1], right: [...sim.p2] } : null,
      money: sim ? { left: sim.leftMoney, right: sim.rightMoney } : null,
      income: sim ? { left: sim.leftIncome, right: sim.rightIncome } : null,
      population: sim ? { left: sim.leftPopulation, right: sim.rightPopulation } : null,
      baseHp: sim ? { left: sim.redBoss.nowHP, right: sim.blueBoss.nowHP } : null,
      alive: sim ? { left: sim.friendList.length, right: sim.enemyList.length } : null,
      units: sim ? Object.fromEntries([['left', sim.friendList], ['right', sim.enemyList]].map(([side, list]) => [side,
        list.filter(unit => unit.kind === 'unit').slice(0, 16).map(unit => ({ id: unit.id, side: unit.side, nowHP: unit.nowHP })),
      ])) : null,
      camera: sim ? { ...sim.renderCamera } : null,
    };
  }
}
