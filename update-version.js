const fs = require('fs');
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const version = packageJson.version;

let indexPath = './index.html';
let html = fs.readFileSync(indexPath, 'utf8');

// Replaces the version string inside the index.html version label
html = html.replace(/v\d+\.\d+\.\d+/, `v${version}`);

fs.writeFileSync(indexPath, html, 'utf8');
console.log(`Updated index.html to version v${version}`);