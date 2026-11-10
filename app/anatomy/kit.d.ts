// Types for kit.js, the organ toolkit carried over from the previous site (only what the roadmap uses).
import type * as THREE from "three";

export function hydrogel(color: THREE.ColorRepresentation, options?: Record<string, number | boolean>): THREE.MeshPhysicalMaterial;
/** Crease shading baked into vertex colours; a generator, so the work can be spread over idle moments. */
export function occlusionJob(group: THREE.Object3D, options?: { cell?: number; floorY?: number | null; strength?: number }): Generator<void, void, void>;
