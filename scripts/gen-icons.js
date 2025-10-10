const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

async function main(){
  const svgPath = path.join(__dirname, '..', 'public', 'bee.svg');
  const out192 = path.join(__dirname, '..', 'public', 'logo192.png');
  const out512 = path.join(__dirname, '..', 'public', 'logo512.png');
  const out32 = path.join(__dirname, '..', 'public', 'favicon-32.png');
  const out16 = path.join(__dirname, '..', 'public', 'favicon-16.png');
  const outIco = path.join(__dirname, '..', 'public', 'favicon.ico');
  if (!fs.existsSync(svgPath)) {
    console.error('bee.svg not found at', svgPath);
    process.exit(1);
  }
  const svg = fs.readFileSync(svgPath);
  await sharp(svg).resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toFile(out192);
  await sharp(svg).resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toFile(out512);
  await sharp(svg).resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toFile(out32);
  await sharp(svg).resize(16, 16, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toFile(out16);
  const icoBuf = await pngToIco([out16, out32]);
  fs.writeFileSync(outIco, icoBuf);
  console.log('Generated', out192, out512, out32, out16, 'and', outIco);
}

main().catch(err => { console.error(err); process.exit(1); });
