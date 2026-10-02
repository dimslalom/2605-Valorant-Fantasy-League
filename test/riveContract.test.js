import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { sourceHash } from '../scripts/rive-build.js';

// The code and the Rive file meet at view model names. If either side renames a
// field, the build still passes and the surface quietly shows nothing, so this
// test pins the contract.

const data = readFileSync(new URL('../rive/fantasy/data.rml', import.meta.url), 'utf8');

function viewModels() {
  const out = {};
  for (const m of data.matchAll(/<ViewModel [^>]*name="(\w+)"[^>]*>([\s\S]*?)<\/ViewModel>/g)) {
    out[m[1]] = [...m[2].matchAll(/<ViewModelProperty(\w+) [^>]*name="(\w+)"/g)].map(p => ({ type: p[1], name: p[2] }));
  }
  return out;
}

const CONTRACT = {
  SlotPlateVM: { handle: 'String', roleLabel: 'String', valueText: 'String', statusText: 'String', form: 'Number' },
  FixtureCardVM: { home: 'String', away: 'String', strengthText: 'String', bestOfText: 'String', mineText: 'String', homeFav: 'Number', awayFav: 'Number', mine: 'Number' },
  FixtureStripVM: { fixtures: 'List' },
  PointsTickerVM: { total: 'Number', label: 'String', deltaText: 'String', deltaShown: 'Number' },
};

test('every field the app sets exists in the Rive file with the right type', () => {
  const vms = viewModels();
  for (const [vm, fields] of Object.entries(CONTRACT)) {
    assert.ok(vms[vm], `view model ${vm} is missing`);
    for (const [name, type] of Object.entries(fields)) {
      const found = vms[vm].find(p => p.name === name);
      assert.ok(found, `${vm}.${name} is missing`);
      assert.equal(found.type, type, `${vm}.${name} should be ${type}`);
    }
  }
});

test('names follow the convention: PascalCase view models, camelCase fields, no Luau keywords', () => {
  const keywords = new Set(['type', 'end', 'local', 'for', 'not', 'repeat', 'and', 'or', 'if', 'then', 'else', 'while', 'do', 'function', 'return', 'nil', 'true', 'false', 'in', 'until', 'break']);
  for (const [vm, props] of Object.entries(viewModels())) {
    assert.match(vm, /^[A-Z][A-Za-z0-9]*$/);
    for (const p of props) {
      assert.match(p.name, /^[a-z][A-Za-z0-9]*$/, `${vm}.${p.name}`);
      assert.ok(!keywords.has(p.name), `${vm}.${p.name} is a Luau keyword`);
    }
  }
});

test('the committed .riv is built from the current RML (run npm run rive:build after editing rive/fantasy)', () => {
  assert.ok(existsSync(new URL('../src/rive/bin/fantasy.riv', import.meta.url)));
  const meta = JSON.parse(readFileSync(new URL('../src/rive/bin/fantasy.meta.json', import.meta.url), 'utf8'));
  assert.equal(meta.srcHash, sourceHash(), 'rive/fantasy changed since the last build');
});

test('only token colours appear in the RML (alpha is free)', () => {
  const tokens = new Set(['0D0F17', '0B0D14', '090D16', '161B29', '1E2435', '10131D', '23293A', '1C2233', '2B3145', 'ECE8E1', '8A8F9E', '818899', 'FF4655', 'FFFFFF', '00C8A0', '032019', 'D8B34C', '8A7330', '211B06']);
  for (const file of ['slot-plate', 'fixture-card', 'fixture-strip', 'points-ticker']) {
    const rml = readFileSync(new URL(`../rive/fantasy/${file}.rml`, import.meta.url), 'utf8');
    for (const m of rml.matchAll(/colorValue="([0-9A-Fa-f]{8})"/g)) {
      assert.ok(tokens.has(m[1].slice(2).toUpperCase()), `${file}: ${m[1]} is not a design token`);
    }
  }
});
