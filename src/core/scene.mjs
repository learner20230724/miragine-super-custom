import { as3int } from './as3.mjs';
import { avm2QuickSort, compareDepthDescending } from './avm2-sort.mjs';

/** Port of dragonforce.core.Symbol's timeline state, independent of bitmap output. */
export class CoreSymbol {
  constructor(simulation) {
    this.simulation = simulation;
    this.uid = simulation.nextUid++;
    this.px = this.py = this.pz = 0;
    this.sx = this.sy = 1;
    this.parent = null;
    this.spriteSheet = null;
    this.spriteMap = null;
    this.action = null;
    this.currentRow = 0;
    // Uninitialized AS3 Number fields default to NaN (unlike int's zero).
    this.currentFrame = NaN;
    this.displayFrame = null;
    this.visible = true;
  }

  gotoAndPlay(action) {
    const map = this.spriteSheet?.[action];
    if (!map || (map === this.spriteMap && map.loop)) return;
    this.spriteMap = map;
    this.action = action;
    this.currentFrame = 1;
    this.displayFrame = as3int(this.currentRow * map.frames + this.currentFrame);
  }

  step() {
    if (!this.spriteMap) return;
    const { frames, speed, loop } = this.spriteMap;
    this.displayFrame = as3int(this.currentRow * frames + this.currentFrame);
    if (this.currentFrame >= frames - speed + 1 - 0.001) {
      if (loop) this.currentFrame = 1;
    } else this.currentFrame += speed;
  }

  visualState() {
    return {
      uid: this.uid, kind: this.kind, id: this.id, side: this.side,
      spriteIndex: this.spriteIndex, weaponSheet: this.weaponSheet,
      px: this.px, py: this.py, pz: this.pz, sx: this.sx, sy: this.sy,
      action: this.action, currentFrame: this.currentFrame,
      displayFrame: this.displayFrame, visible: this.visible,
      nowHP: this.nowHP, maxHP: this.maxHP, spawnHP: this.spawnHP,
    };
  }
}

/** Flash display-list semantics: appending existing children reorders them. */
export class CoreScene {
  constructor() { this.children = []; }
  get numChildren() { return this.children.length; }
  addChild(child) {
    if (child.parent) child.parent.removeChild(child);
    this.children.push(child);
    child.parent = this;
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error('CoreScene.removeChild: object is not a child');
    this.children.splice(index, 1);
    child.parent = null;
    return child;
  }
  step() {
    // Deliberately NOT a copied list: the original processes newly appended attacks
    // in this frame, and removal skips the subsequent child at the shifted index.
    for (let index = 0; index < this.children.length; index++) this.children[index].step();
  }
  applyOriginalRenderOrder() {
    // DragonForceRenderEngine sorts DESCENDING then addChilds in reverse order.
    // AVM2's non-stable QuickSort equal-key swaps affect subsequent Scene.step.
    const sorted = avm2QuickSort([...this.children], compareDepthDescending);
    this.children = sorted.reverse();
  }
}
