/*
 * Public API surface of seep-engine.
 *
 * This library is intentionally framework-agnostic: no Angular imports,
 * no DOM access. Every export here is a plain TypeScript type or a pure
 * function. It is consumed by the seep-web Angular application, and is
 * unit- and fuzz-tested independently with Vitest (see src/lib/__tests__).
 */

export * from './lib/card';
export * from './lib/deck';
export * from './lib/hand';
export * from './lib/floor';
export * from './lib/scoring';
export * from './lib/player';
export * from './lib/gameEngine';
export * from './lib/computer';
export * from './lib/seats';
export * from './lib/fourPlayerEngine';
