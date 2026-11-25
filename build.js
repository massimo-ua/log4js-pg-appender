const esbuild = require('esbuild');
const { readFile } = require('fs/promises');
const path = require('path');

async function getBanner() {
  const pkg = JSON.parse(
    await readFile(path.join(__dirname, 'package.json'), 'utf8')
  );
  return `/**
 * @license
 * ${pkg.name} v${pkg.version}
 * Copyright (c) ${new Date().getFullYear()} ${pkg.author}
 * Licensed under the ${pkg.license} license
 */`;
}

async function build() {
  const banner = await getBanner();
  
  try {
    const result = await esbuild.build({
      entryPoints: ['./index.js'],
      bundle: true,
      minify: true,
      platform: 'node',
      target: 'node20',
      outfile: 'dist/log4js-pg-appender.min.js',
      banner: {
        js: banner,
      },
      external: ['pg'], // Don't bundle external dependencies
      format: 'cjs',
      metafile: true,
      sourcemap: true,
    });

    // Output build analysis
    const text = await esbuild.analyzeMetafile(result.metafile);
    // eslint-disable-next-line no-console
    console.log('Build analysis:', text);

  } catch (error) {
     
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
