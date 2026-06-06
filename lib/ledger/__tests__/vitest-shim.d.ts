// Minimal ambient declaration so completeness.test.ts typechecks BEFORE the real
// runner is installed (the repo has no vitest yet — only Playwright e2e).
//
// This is a TYPES-ONLY shim. It is automatically shadowed by the real package's
// own types the moment you run `npm i -D vitest`. Delete this file then if you
// prefer the upstream types exclusively — it is not needed at runtime, only to
// keep `tsc --noEmit` at zero errors while a runner is pending.
//
// Do NOT import from here. It only stops TS2307 on `import ... from "vitest"`.

declare module "vitest" {
  type TestFn = () => void | Promise<void>;
  export function describe(name: string, fn: TestFn): void;
  export function it(name: string, fn: TestFn): void;
  export function test(name: string, fn: TestFn): void;
  export function beforeAll(fn: TestFn): void;
  export function afterAll(fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;

  interface Assertion {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    not: Assertion;
  }
  export function expect(actual: unknown): Assertion;
}
