import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { VERSION } from '../src/version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPkg() {
  return JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
}

describe('server scaffold', () => {
  it('package.json declares ESM and the vitest test script', () => {
    const pkg = readPkg();
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('declares the locked runtime dependencies', () => {
    const deps = readPkg().dependencies ?? {};
    expect(deps).toHaveProperty('express');
    expect(deps).toHaveProperty('better-sqlite3');
    expect(deps).toHaveProperty('socket.io');
    expect(deps).toHaveProperty('fast-xml-parser');
  });

  it('declares the locked dev/test dependencies', () => {
    const dev = readPkg().devDependencies ?? {};
    expect(dev).toHaveProperty('vitest');
    expect(dev).toHaveProperty('supertest');
  });

  it('exposes a string VERSION via ESM import', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });
});
