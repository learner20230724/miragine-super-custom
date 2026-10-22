// Run with playwright-cli run-code --filename tools/browser-smoke.cli.js.
// The browser must already be on the development server. No game state is mutated
// through debugging hooks: every action below is an actual pointer/key input.
(async function (page) {
  const checks = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, name) => {
    if (!condition) throw new Error(`Browser check failed: ${name}`);
    checks.push(name);
  };
  const state = () => page.evaluate(() => window.__MIRAGINE__.getState());
  const settle = () => page.waitForTimeout(120);
  async function press(code) {
    await page.keyboard.down(code);
    await page.waitForTimeout(55);
    await page.keyboard.up(code);
    await settle();
  }
  async function hit(action, matches = {}) {
    await settle();
    const { hotspot, fit } = await page.evaluate(({ action, matches }) => ({
      hotspot: window.__MIRAGINE__.getHotspots().find(h => h.action === action &&
        Object.entries(matches).every(([key, value]) => h[key] === value)),
      fit: window.__MIRAGINE__.getState().viewport,
    }), { action, matches });
    if (!hotspot) throw new Error(`No current hotspot: ${action} ${JSON.stringify(matches)}`);
    await page.mouse.click(fit.clientLeft + fit.left + (hotspot.left + hotspot.right) / 2 * fit.scale,
      fit.clientTop + fit.top + (hotspot.top + hotspot.bottom) / 2 * fit.scale);
    await settle();
  }
  async function dismissHelp() {
    if ((await state()).overlay === 'tutorial') await hit('tutorial-okay');
  }

  await page.goto(page.url());
  await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 30000 });
  assert((await state()).implementation === 'native-javascript-canvas', 'native JavaScript game loads');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await settle();
  let s = await state();
  assert(s.viewport.width === 1440 && s.viewport.height === 1080 && s.viewport.left === 240,
    'wide window fits 4:3 without cropping');
  await page.mouse.click(20, 400);
  assert((await state()).panel === 'home', 'black bar click is ignored');
  await hit('single');
  await page.waitForTimeout(600);
  assert((await state()).panel === 'difficulty', 'wide-window single-player click maps correctly');
  await page.setViewportSize({ width: 900, height: 1400 });
  await settle();
  s = await state();
  assert(s.viewport.width === 900 && s.viewport.height === 675 && s.viewport.top === 362.5,
    'portrait window fits without cropping');
  await hit('difficulty', { value: 1 });
  await page.waitForTimeout(1100);
  await dismissHelp();
  assert((await state()).phase === 'game' && (await state()).singlePlay, 'normal single-player starts');
  await hit('unit', { side: 'left', id: 3 });
  assert((await state()).selection.left[0] === 3 && (await state()).selection.left[1] === 0,
    'portrait-window unit click selects original unit');
  const rightBefore = JSON.stringify((await state()).selection.right);
  await hit('unit', { side: 'right', id: 5 });
  assert(JSON.stringify((await state()).selection.right) === rightBefore,
    'single-player opponent is not mouse-controlled');
  await press('KeyD');
  assert((await state()).selection.left[0] === 4, 'WASD changes player-one selection');
  const beforeToggle = await state();
  await press('Space');
  s = await state();
  assert(s.selection.left[2] !== beforeToggle.selection.left[2] && s.running,
    'Space toggles recruitment, not global pause');
  await press('Space');
  await hit('music');
  assert((await state()).muted, 'sound button toggles mute');
  await hit('music');
  assert(!(await state()).muted, 'sound button restores sound');
  await page.setViewportSize({ width: 1280, height: 960 });
  await settle();
  await hit('minimap');
  const cameraAfterMap = (await state()).camera.x;
  assert(cameraAfterMap > 1500, 'minimap click changes camera in world coordinates');
  await hit('tutorial');
  const helpBefore = await state();
  await page.waitForTimeout(150);
  assert((await state()).frame > helpBefore.frame && !(await state()).stopTimer,
    'manual help does not stop original simulation or round clock');
  await press('KeyD');
  assert((await state()).selection.left[0] === 5, 'original keyboard controls continue under help');
  await hit('unit', { side: 'left', id: 2 });
  assert((await state()).selection.left[0] === 2, 'cards outside original help panel remain clickable');
  await press('Escape');
  assert((await state()).overlay === 'quit', 'quit confirmation can overlay help');
  await press('KeyD');
  assert((await state()).selection.left[0] === 3, 'original keyboard controls continue under quit');
  await hit('quit-cancel');
  assert((await state()).overlay === 'tutorial', 'quit cancel restores underlying help');
  await dismissHelp();
  await press('Escape');
  assert((await state()).overlay === 'quit', 'Escape opens quit confirmation');
  await hit('quit-cancel');
  assert((await state()).phase === 'game' && !(await state()).overlay, 'quit cancel resumes game view');
  await press('Escape');
  await hit('quit-confirm');
  await page.waitForTimeout(1100);
  assert((await state()).phase === 'title', 'quit confirm returns to original menu');
  await hit('dual');
  await page.waitForTimeout(1100);
  await dismissHelp();
  assert(!(await state()).singlePlay, 'local two-player starts');
  await hit('unit', { side: 'right', id: 3 });
  await press('ArrowRight');
  assert((await state()).selection.right[0] === 4, 'player two supports mouse and arrow keys');
  s = await state();
  await press('Enter');
  const afterEnter = await state();
  assert(afterEnter.selection.right[2] !== s.selection.right[2] &&
    afterEnter.selection.left[2] === s.selection.left[2], 'Enter toggles only player-two recruitment');
  await press('Enter');
  for (const size of [[640,480],[2560,1440],[480,900],[1280,960]]) {
    await page.setViewportSize({ width: size[0], height: size[1] });
    await settle();
    const fit = (await state()).viewport;
    assert(Math.abs(fit.width / fit.height - 4 / 3) < 1e-12 && fit.width <= size[0] && fit.height <= size[1],
      `aspect fit at ${size[0]}x${size[1]}`);
    await hit('unit', { side: 'left', id: 6 });
    assert((await state()).selection.left[0] === 6, `actual pointer accuracy at ${size[0]}x${size[1]}`);
  }
  await page.waitForFunction(() => window.__MIRAGINE__.getState().income.left > 500,
    null, { timeout: 15000 });
  s = await state();
  assert(s.alive.left > 1 && s.income.left > 500, 'default income settlement recruits original units');
  assert(s.rendering?.missingSprites?.length === 0 && s.rendering?.ground?.triangleCount > 0,
    'original sprite assets and WebGL perspective ground render');
  await page.screenshot({ path: 'output/playwright/native-smoke-dual.png', scale: 'css' });
  assert(errors.length === 0 && s.ready && !s.error, 'no runtime JavaScript errors');
  return { checks, passed: checks.length, errors, final: s };
})
