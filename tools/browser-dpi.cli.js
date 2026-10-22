// Run through the same playwright-cli session as browser-smoke.cli.js.
(async function(page) {
  const results = [];
  const url = page.url();
  for (const dpr of [1.25, 1.5, 2]) {
    const context = await page.context().browser().newContext({
      viewport: {width: 1600, height: 1000}, deviceScaleFactor: dpr,
    });
    try {
      const probe = await context.newPage();
      await probe.goto(url);
      await probe.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, {timeout: 30000});
      let fit = await probe.evaluate(() => window.__MIRAGINE__.getState().viewport);
      if (fit.devicePixelRatio !== dpr || fit.backingWidth !== Math.round(fit.width*dpr) ||
        fit.backingHeight !== Math.round(fit.height*dpr)) throw Error(`DPI backing mismatch at ${dpr}`);
      const hit = async action => {
        const {h,f} = await probe.evaluate(action => ({
          h: window.__MIRAGINE__.getHotspots().find(h=>h.action===action),
          f: window.__MIRAGINE__.getState().viewport,
        }), action);
        if (!h) throw Error(`Missing hotspot ${action}`);
        await probe.mouse.click(f.left+(h.left+h.right)/2*f.scale,
          f.top+(h.top+h.bottom)/2*f.scale);
        await probe.waitForTimeout(650);
      };
      await hit('single');
      const state = await probe.evaluate(() => window.__MIRAGINE__.getState());
      if (state.panel !== 'difficulty' || !state.ready || state.error) throw Error(`DPI pointer mismatch at ${dpr}`);
      results.push({dpr, backingWidth:fit.backingWidth, backingHeight:fit.backingHeight,
        cssWidth:fit.width, cssHeight:fit.height, pointerCheck:'passed'});
      if (dpr===2) await probe.screenshot({path:'output/playwright/native-dpi2.png',scale:'css'});
    } finally { await context.close(); }
  }
  return {passed:results.length,results};
})
