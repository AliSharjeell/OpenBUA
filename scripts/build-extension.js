import { build as esbuild } from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function buildExtension() {
  console.log('🚀 [1/4] Running Vite build for Sidepanel & Background...');
  execSync('npx vite build', { stdio: 'inherit' });

  console.log('📦 [2/4] Bundling content script with esbuild to dist/content.js...');
  await esbuild({
    entryPoints: ['src/content/content-script.ts'],
    outfile: 'dist/content.js',
    bundle: true,
    format: 'iife',
    target: ['chrome100'],
    minify: false,
    sourcemap: false,
  });

  console.log('📋 [3/4] Copying manifest.json, test-form.html, and icons to dist/...');
  fs.copyFileSync('manifest.json', 'dist/manifest.json');
  if (fs.existsSync('test-form.html')) {
    fs.copyFileSync('test-form.html', 'dist/test-form.html');
  }

  const iconsSrcDir = 'public/icons';
  const iconsDistDir = 'dist/icons';
  if (!fs.existsSync(iconsDistDir)) {
    fs.mkdirSync(iconsDistDir, { recursive: true });
  }

  if (fs.existsSync(iconsSrcDir)) {
    const iconFiles = fs.readdirSync(iconsSrcDir);
    for (const icon of iconFiles) {
      fs.copyFileSync(path.join(iconsSrcDir, icon), path.join(iconsDistDir, icon));
    }
  }

  console.log('✨ [4/4] Extension build completed successfully!');
  console.log('---------------------------------------------------------');
  console.log('🎉 Dist directory is ready at: form-filling-ai/dist');
  console.log('📌 To test in Chrome:');
  console.log('   1. Open chrome://extensions/');
  console.log('   2. Enable "Developer mode" toggle (top-right)');
  console.log('   3. Click "Load unpacked" and select the "dist" folder');
  console.log('   4. Click the AutoForm AI icon to open the Side Panel!');
  console.log('---------------------------------------------------------');
}

buildExtension().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
