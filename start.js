const { spawn } = require('child_process');
const electronExe = require('electron'); // In normal Node, this returns the path

// Delete the environment variable injected by the terminal/IDE context
// that forces Electron to run as a normal Node.js process.
delete process.env.ELECTRON_RUN_AS_NODE;

console.log('Spawning Electron API at:', electronExe);

const child = spawn(electronExe, ['.', '--disable-gpu', '--no-sandbox', ...process.argv.slice(2)], {
    stdio: 'inherit'
});

child.on('close', (code) => {
    process.exit(code);
});
