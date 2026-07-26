/**
 * Fixed-capacity circular buffer. push() is O(1) regardless of capacity —
 * unlike an array with shift(), which is O(n) per push once at capacity.
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error("RingBuffer capacity must be greater than 0");
    }
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    const index = (this.start + this.count) % this.capacity;
    this.buffer[index] = item;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
  }

  /** Iterates oldest-to-newest without allocating an intermediate array. */
  forEach(callback: (item: T) => void): void {
    for (let i = 0; i < this.count; i++) {
      callback(this.buffer[(this.start + i) % this.capacity] as T);
    }
  }

  toArray(): T[] {
    const result: T[] = [];
    this.forEach((item) => result.push(item));
    return result;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.start = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}