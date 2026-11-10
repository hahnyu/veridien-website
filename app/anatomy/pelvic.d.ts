import type * as THREE from "three";

/** Uterus (with tubes, ovaries and ligaments as children, a fibroid morph target and fibroid nodules) and bladder. */
export function buildPelvic(): { meshes: THREE.Mesh[]; uterus: THREE.Mesh; fibroids: THREE.Group };
