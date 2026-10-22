'use strict';
// Electron's development loader imports the package entry rather than marking
// it require.main. Keep startup explicit and the reusable module side-effect free.
require('./main.cjs').startDesktop().catch(() => { process.exitCode = 1; });
