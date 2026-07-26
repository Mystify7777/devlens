import { describe, it, expect } from "vitest";
import { RingBuffer } from "./ring-buffer";

describe("RingBuffer", () => {
  it("throws on zero capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
  });

  it("throws on negative capacity", () => {
    expect(() => new RingBuffer(-1)).toThrow();
  });

  it("preserves insertion order within capacity", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    expect(buffer.toArray()).toEqual([1, 2, 3]);
  });

  it("overwrites the oldest item once at capacity", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it("maintains correct order across multiple wraparounds", () => {
    const buffer = new RingBuffer<number>(3);
    for (let i = 1; i <= 10; i++) buffer.push(i);
    expect(buffer.toArray()).toEqual([8, 9, 10]);
  });

  it("works correctly with capacity 1", () => {
    const buffer = new RingBuffer<number>(1);
    buffer.push(1);
    buffer.push(2);
    expect(buffer.toArray()).toEqual([2]);
  });

  it("clear() empties the buffer", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.clear();
    expect(buffer.toArray()).toEqual([]);
    expect(buffer.size).toBe(0);
  });

  it("forEach visits items in the same order as toArray", () => {
    const buffer = new RingBuffer<number>(3);
    [1, 2, 3, 4].forEach((n) => buffer.push(n));
    const visited: number[] = [];
    buffer.forEach((n) => visited.push(n));
    expect(visited).toEqual(buffer.toArray());
  });
});