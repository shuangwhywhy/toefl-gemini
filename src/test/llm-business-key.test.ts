import { describe, expect, it } from 'vitest';
import { createBusinessKey, hashBlobForBusinessKey } from '../services/llm/businessKey';

describe('BusinessKey', () => {
  it('generates stable keys for objects regardless of key order', () => {
    const obj1 = { a: 1, b: 2 };
    const obj2 = { b: 2, a: 1 };
    
    const key1 = createBusinessKey('test', obj1);
    const key2 = createBusinessKey('test', obj2);
    
    expect(key1).toBe(key2);
    expect(key1.startsWith('test:')).toBe(true);
  });

  it('handles long strings by hashing them', () => {
    const longString = 'a'.repeat(300);
    const key = createBusinessKey('test', longString);
    
    // Changing one character should change the key
    const longString2 = 'a'.repeat(299) + 'b';
    const key2 = createBusinessKey('test', longString2);
    
    expect(key).not.toBe(key2);
  });

  it('normalizes functions by their source code', () => {
    const fn1 = (x: number) => x + 1;
    const fn2 = (x: number) => { return x + 1; };
    const fn3 = (x: number) => x + 1; // Same as fn1
    
    const key1 = createBusinessKey('test', fn1);
    const key2 = createBusinessKey('test', fn2);
    const key3 = createBusinessKey('test', fn3);
    
    expect(key1).toBe(key3);
    expect(key1).not.toBe(key2);
  });

  it('handles Uint8Array and Blob', async () => {
    // Some test environments (JSDOM) might not have arrayBuffer on Blob
    if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = async function() {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.readAsArrayBuffer(this);
        });
      };
    }

    const data = new Uint8Array([1, 2, 3, 4]);
    const key1 = createBusinessKey('test', data);
    
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const key2 = createBusinessKey('test', blob);
    
    expect(key1).toContain('test:');
    expect(key2).toContain('test:');
    
    const blobHash = await hashBlobForBusinessKey(blob);
    expect(blobHash).toContain('text/plain:5:');
  });

  it('ignores undefined values in objects', () => {
    const obj1 = { a: 1, b: undefined };
    const obj2 = { a: 1 };
    
    expect(createBusinessKey('test', obj1)).toBe(createBusinessKey('test', obj2));
  });

  it('handles nested structures', () => {
    const complex = {
      arr: [1, { x: 'y' }],
      date: new Date('2026-01-01'),
      meta: { foo: 'bar' }
    };
    const key = createBusinessKey('test', complex);
    expect(key).toBeDefined();
  });
});
