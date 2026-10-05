import { defineConfig, type Plugin } from 'vite';
import { randomInt } from 'node:crypto';
import JavaScriptObfuscator from 'javascript-obfuscator';

/**
 * Üretim derlemesinde oyun kodunu karartır (three.js gibi kütüphaneler ayrı 'vendor' chunk'ında
 * kalır ve karartılmaz). Her derlemede seed rastgeledir: dosya adları ve iç yapı değişir,
 * önceki sürüm için yazılmış scriptler ve DevTools Overrides yamaları çalışmaz.
 * VITE_KERVAN_DEBUG=1 ile derlenen test sürümü karartılmaz.
 */
function obfuscate(): Plugin {
  const seed = randomInt(1, 2 ** 31 - 1);
  return {
    name: 'kervan-obfuscate',
    apply: 'build',
    enforce: 'post',
    // küçültmeden SONRA çalışmalı (selfDefending biçim değişikliğine duyarlı)
    generateBundle(_opts, bundle) {
      if (process.env.VITE_KERVAN_DEBUG === '1') return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || chunk.name === 'vendor') continue;
        chunk.code = obfuscateCode(chunk.code, seed);
      }
    },
  };
}

function obfuscateCode(code: string, seed: number): string {
  const out = JavaScriptObfuscator.obfuscate(code, {
    seed,
    target: 'browser',
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersType: 'function',
    splitStrings: true,
    splitStringsChunkLength: 8,
    transformObjectKeys: false,
    numbersToExpressions: false,
    // performans: kontrol akışı düzleştirme ve ölü kod oyun döngüsünü yavaşlatır
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: true,
    simplify: true,
    sourceMap: false,
    unicodeEscapeSequence: false,
  });
  return out.getObfuscatedCode();
}

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
    },
  },
  plugins: [obfuscate()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
