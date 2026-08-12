import type { ReadonlyEntityCollection, SafeEntity, World } from 'objecs';
import type { Entity } from './entity.ts';

export type ShipEntity = SafeEntity<
  Entity,
  'transform' | 'previous' | 'velocity' | 'ship'
>;
export type PlanetEntity = SafeEntity<Entity, 'transform' | 'planet' | 'pulse'>;
export type StarEntity = SafeEntity<Entity, 'transform' | 'star' | 'pulse'>;
export type PulseEntity = SafeEntity<Entity, 'pulse'>;
export type ParticleEntity = SafeEntity<
  Entity,
  'transform' | 'velocity' | 'particle'
>;
export type BulletEntity = SafeEntity<
  Entity,
  'transform' | 'previous' | 'velocity' | 'bullet'
>;
export type EnemyEntity = SafeEntity<
  Entity,
  'transform' | 'previous' | 'velocity' | 'enemy'
>;

// Live archetype queries, created once and shared (ESM live bindings) between
// the sim and render modules.
export let world!: World<Entity>;
export let ships!: ReadonlyEntityCollection<ShipEntity>;
export let planets!: ReadonlyEntityCollection<PlanetEntity>;
export let stars!: ReadonlyEntityCollection<StarEntity>;
export let pulses!: ReadonlyEntityCollection<PulseEntity>;
export let particles!: ReadonlyEntityCollection<ParticleEntity>;
export let bullets!: ReadonlyEntityCollection<BulletEntity>;
export let enemies!: ReadonlyEntityCollection<EnemyEntity>;

export function initQueries(w: World<Entity>) {
  world = w;
  ships = w.archetype('transform', 'previous', 'velocity', 'ship').entities;
  planets = w.archetype('transform', 'planet', 'pulse').entities;
  stars = w.archetype('transform', 'star', 'pulse').entities;
  pulses = w.archetype('pulse').entities;
  particles = w.archetype('transform', 'velocity', 'particle').entities;
  bullets = w.archetype('transform', 'previous', 'velocity', 'bullet').entities;
  enemies = w.archetype('transform', 'previous', 'velocity', 'enemy').entities;
}
