const fs = require('fs');
const path = require('path');

function main() {
  const root = path.join(__dirname, '..');
  const nodes = fs.readdirSync(root).filter((f) => f.endsWith('.node'));
  if (nodes.length === 0) {
    console.error('smoke: engine 根目录没有 .node，先 npm run build');
    process.exit(1);
  }
  const mod = require(path.join(root, nodes[0]));
  const info = typeof mod.engineInfo === 'function' ? mod.engineInfo() : mod.engine_info();
  console.log(`smoke native: ${nodes[0]} -> ${info}`);
  if (!info.includes('kawaii-core') || !info.includes('napi')) {
    console.error('smoke: 自述串不符合预期', info);
    process.exit(1);
  }
  console.log('smoke native OK');
}

main();
