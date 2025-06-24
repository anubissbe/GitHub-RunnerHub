// Simple test to verify ts-jest is working
export const add = (a: number, b: number): number => a + b;

describe('Simple TypeScript Test', () => {
  it('should add two numbers correctly', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('should handle type annotations', () => {
    const result: number = add(10, 20);
    expect(result).toBe(30);
  });
});