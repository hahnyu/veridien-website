/* Shared toolkit for the modular simulator: geometry builders (noise blobs, variable-radius
   tubes, the cover dome), the cast-hydrogel material, and baked crease shading.
   Organ modules in organs/*.js build their anatomy from these. */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const CLINICAL = new THREE.Color('#4fa3d1');
export const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
export const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
export const easeInOut = (v) => { const t = clamp01(v); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

/* Cheap, deterministic organic noise (sum of sines), roughly -1..1 */
export const noise3 = (x, y, z) =>
  Math.sin(x * 1.7 + 1.3) * Math.sin(y * 2.3 + 0.4) * Math.sin(z * 1.9 + 2.1) +
  0.5 * Math.sin(x * 3.1 + 0.7) * Math.sin(y * 3.7 + 1.9) * Math.sin(z * 2.9 + 0.2) +
  0.25 * Math.sin(x * 6.3 + 2.2) * Math.sin(y * 5.9 + 0.8) * Math.sin(z * 6.7 + 1.4);

/* ---------------------------------------------------------------- geometry */

/* Smooth closed organ: a unit sphere pushed through deform(x, y, z, n) -> [X, Y, Z],
   where n is a noise sample. An optional second deform becomes a morph target. */
export function blob({ detail = 4, freq = 1.6, seed = 0, deform, morph = null }) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const unit = g.attributes.position.array.slice();
  const shapeWith = (fn) => {
    const out = new Float32Array(unit.length);
    for (let i = 0; i < unit.length; i += 3) {
      const x = unit[i], y = unit[i + 1], z = unit[i + 2];
      const n = noise3(x * freq + seed, y * freq - seed * 0.7, z * freq + seed * 1.3);
      const p = fn(x, y, z, n);
      out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
    }
    return out;
  };
  g.setAttribute('position', new THREE.BufferAttribute(shapeWith(deform), 3));
  g.computeVertexNormals();
  if (morph) {
    const tmp = new THREE.BufferGeometry();
    tmp.setIndex(g.index);
    tmp.setAttribute('position', new THREE.BufferAttribute(shapeWith(morph), 3));
    tmp.computeVertexNormals();
    g.morphAttributes.position = [tmp.attributes.position];
    g.morphAttributes.normal = [tmp.attributes.normal];
  }
  return g;
}

/* Tube along a smooth curve with radius(t, angle); ends taper closed. */
export function tube(points, { segments = 240, radial = 18, radius }) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [];
  const idx = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const r = radius(t, a);
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(P.x + r * (c * N.x + s * B.x), P.y + r * (c * N.y + s * B.y), P.z + r * (c * N.z + s * B.z));
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = (i + 1) * radial + j;
      const c = (i + 1) * radial + ((j + 1) % radial);
      const d = i * radial + ((j + 1) % radial);
      idx.push(a, d, b, b, d, c);
    }
  }
  const start = pos.length / 3;
  curve.getPointAt(0, P);
  pos.push(P.x, P.y, P.z);
  const end = start + 1;
  curve.getPointAt(1, P);
  pos.push(P.x, P.y, P.z);
  const last = segments * radial;
  for (let j = 0; j < radial; j++) {
    idx.push(start, (j + 1) % radial, j);
    idx.push(end, last + j, last + ((j + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Rounded ends for tube radius functions */
export const capped = (t, edge = 0.04) => {
  const e = Math.min(t, 1 - t);
  return e >= edge ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow(1 - e / edge, 2)));
};

export function roundedRect(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/* Boxy dome (upper half of a superellipsoid), like a torso trainer cover.
   Unit size; scale by (A, B, C). Exponent p > 2 squares off the sides. */
export const DOME_P = 3.0;
export function superDome(p = DOME_P, wSeg = 112, hSeg = 56) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = Math.pow(Math.abs(x) ** p + Math.abs(y) ** p + Math.abs(z) ** p, 1 / p);
    pos.setXYZ(i, x / k, y / k, z / k);
  }
  g.computeVertexNormals();
  return g;
}
export function superOutline(a, c, p = DOME_P, steps = 160) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    pts.push(new THREE.Vector2(a * Math.sign(ct) * Math.abs(ct) ** (2 / p), c * Math.sign(st) * Math.abs(st) ** (2 / p)));
  }
  return pts;
}

/* ---------------------------------------------------------------- materials */

/* Surface detail: one small tileable texture, generated once at load (no download).
   R, G: slope of a height field (fine grain plus small pits, like bubbles in cast gel)
   B: soft mottling for color variation   A: the pits themselves */
let detailTexture = null;
export function surfaceDetail() {
  if (detailTexture) return detailTexture;
  const N = 256;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Value noise that tiles across the texture edges
  const layer = (period) => {
    const g = Float32Array.from({ length: period * period }, rand);
    return (x, y) => {
      const fx = (x / N) * period, fy = (y / N) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[((j % period) + period) % period * period + ((i % period) + period) % period];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const grain = [[layer(8), 0.45], [layer(16), 0.3], [layer(32), 0.17], [layer(64), 0.08]];
  const mottle = [[layer(3), 0.6], [layer(6), 0.4]];
  const height = new Float32Array(N * N);
  const pits = new Float32Array(N * N);
  const tone = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let h = 0;
      for (const [f, a] of grain) h += f(x, y) * a;
      let m = 0;
      for (const [f, a] of mottle) m += f(x, y) * a;
      height[y * N + x] = h;
      tone[y * N + x] = m;
    }
  }
  for (let k = 0; k < 90; k++) {
    const cx = rand() * N, cy = rand() * N, r = 2.5 + rand() * rand() * 7;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d >= 1) continue;
        const i = ((Math.floor(cy + dy) % N + N) % N) * N + ((Math.floor(cx + dx) % N + N) % N);
        const depth = 1 - d * d;
        pits[i] = Math.max(pits[i], depth);
      }
    }
  }
  for (let i = 0; i < N * N; i++) height[i] -= pits[i] * 0.9;
  const at = (x, y) => height[((y + N) % N) * N + ((x + N) % N)];
  const slopes = new Float32Array(N * N * 2);
  let maxSlope = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const du = (at(x + 1, y) - at(x - 1, y)) / 2, dv = (at(x, y + 1) - at(x, y - 1)) / 2;
      slopes[(y * N + x) * 2] = du;
      slopes[(y * N + x) * 2 + 1] = dv;
      maxSlope = Math.max(maxSlope, Math.abs(du), Math.abs(dv));
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(127.5 + 127 * slopes[i * 2] / maxSlope);
    data[i * 4 + 1] = Math.round(127.5 + 127 * slopes[i * 2 + 1] / maxSlope);
    data[i * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, tone[i])));
    data[i * 4 + 3] = Math.round(255 * pits[i]);
  }
  detailTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  detailTexture.wrapS = detailTexture.wrapT = THREE.RepeatWrapping;
  detailTexture.magFilter = THREE.LinearFilter;
  detailTexture.minFilter = THREE.LinearMipmapLinearFilter;
  detailTexture.generateMipmaps = true;
  detailTexture.anisotropy = 4;
  detailTexture.needsUpdate = true;
  return detailTexture;
}

/* Cast PVA hydrogel: satin rather than glossy, with fine surface texture, soft mottling, and
   light that glows through thin parts and back-lit edges (a cheap stand-in for real
   translucency, which would need a second render pass every frame). The texture is projected
   from three sides in the organ's own space, so it needs no UVs and stays put as modules move. */
export function hydrogel(color, {
  roughness = 0.46, opacity = 1, vertexColors = true,
  scale = 1.2, bump = 0.55, pits = 0.5, mottle = 0.18, marble = 0,
  glow = 0.3, edge = 0.07,
} = {}) {
  const base = new THREE.Color(color);
  const m = new THREE.MeshPhysicalMaterial({
    color: base,
    roughness,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.24,
    ior: 1.36,
    envMapIntensity: 0.7,
    vertexColors,
    transparent: opacity < 1,
    opacity,
  });
  // Light passing through the gel takes on a deeper, more saturated version of its color
  const hsl = base.getHSL({});
  const glowColor = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.1), Math.min(0.5, hsl.l + 0.03));
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      detailMap: { value: surfaceDetail() },
      detailScale: { value: scale },
      bumpStrength: { value: bump },
      pitStrength: { value: pits },
      mottleStrength: { value: mottle },
      marbleStrength: { value: marble },
      glowColor: { value: glowColor },
      glowStrength: { value: glow },
      edgeStrength: { value: edge },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\nvObjPos = transformed;\nvObjNormal = objectNormal;');
    const lights = THREE.ShaderChunk.lights_fragment_begin.replaceAll(
      'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
      '$&\n\t\tglowThrough( directLight, geometryNormal, geometryViewDir, reflectedLight );'
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        #ifndef USE_NORMALMAP_OBJECTSPACE
        uniform mat3 normalMatrix;
        #endif
        uniform sampler2D detailMap;
        uniform float detailScale, bumpStrength, pitStrength, mottleStrength, marbleStrength, glowStrength, edgeStrength;
        uniform vec3 glowColor;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;`)
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
        // Back light seen through the gel, plus a little light wrapping past the terminator
        void glowThrough( const in IncidentLight light, const in vec3 n, const in vec3 v, inout ReflectedLight reflected ) {
          float back = pow( saturate( dot( v, -normalize( light.direction + n * 0.4 ) ) ), 3.0 );
          float wrap = saturate( ( dot( n, light.direction ) + 0.6 ) / 1.6 ) - saturate( dot( n, light.direction ) );
          reflected.directDiffuse += glowColor * light.color * ( back + 0.3 * wrap ) * glowStrength;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 dN = normalize( vObjNormal );
        vec3 dW = pow( abs( dN ), vec3( 4.0 ) );
        dW /= dW.x + dW.y + dW.z;
        vec3 dP = vObjPos * detailScale;
        vec4 dX = texture2D( detailMap, dP.yz );
        vec4 dY = texture2D( detailMap, dP.zx );
        vec4 dZ = texture2D( detailMap, dP.xy );
        vec4 detail = dX * dW.x + dY * dW.y + dZ * dW.z;
        diffuseColor.rgb *= 1.0 + ( detail.b - 0.5 ) * 2.0 * mottleStrength;
        diffuseColor.rgb *= 1.0 - detail.a * pitStrength * 0.25;
        if ( marbleStrength > 0.0 ) {
          // Soft white swirls, like the two-tone gel the fibroids are cast in
          vec3 q = vObjPos * 16.0;
          float swirl = sin( q.x + 2.2 * sin( q.y * 0.8 + q.z * 0.55 ) ) * sin( q.z * 0.9 + 1.8 * sin( q.x * 0.7 ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.97, 0.93, 0.92 ), smoothstep( 0.1, 0.6, swirl ) * marbleStrength );
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp( roughnessFactor + detail.a * pitStrength * 0.3, 0.05, 1.0 );`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 slope = dW.x * vec3( 0.0, dX.r - 0.5, dX.g - 0.5 )
                     + dW.y * vec3( dY.g - 0.5, 0.0, dY.r - 0.5 )
                     + dW.z * vec3( dZ.r - 0.5, dZ.g - 0.5, 0.0 );
          normal = normalize( normalMatrix * normalize( dN - slope * bumpStrength ) ) * faceDirection;
        }`)
      .replace('#include <lights_fragment_begin>', lights)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Thin, grazing edges let a little more light through
        totalEmissiveRadiance += glowColor * pow( 1.0 - saturate( abs( dot( normal, normalize( vViewPosition ) ) ) ), 3.0 ) * edgeStrength;`);
  };
  m.customProgramCacheKey = () => 'veridien-hydrogel-2';
  return m;
}

/* Crease shading, worked out once when the model is built: each vertex is darkened by how
   much solid matter (other organs in the module, the tray floor) crowds the space just outside
   it. Organs are voxelized as solids (surfaces rasterized, insides flood-filled), so bowel loops
   shade each other where they touch. Stored as vertex colors: no cost per frame.
   Written as a generator that yields often, so the work can be spread over idle moments. */
export function* occlusionJob(group, { cell = 0.08, floorY = null, strength = 0.82 } = {}) {
  group.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const items = [];
  group.traverse((o) => {
    // Only organs take part (the tray floor is handled by floorY)
    if (!o.isMesh || !o.material.vertexColors) return;
    const m = new THREE.Matrix4().multiplyMatrices(toGroup, o.matrixWorld);
    items.push({ mesh: o, m, nm: new THREE.Matrix3().getNormalMatrix(m) });
  });
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  items.forEach(({ mesh, m }) => {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
  });
  box.expandByScalar(cell * 14);
  const nx = Math.ceil((box.max.x - box.min.x) / cell), ny = Math.ceil((box.max.y - box.min.y) / cell), nz = Math.ceil((box.max.z - box.min.z) / cell);
  yield;
  const grid = new Uint8Array(nx * ny * nz);
  const cellOf = (x, y, z) => {
    const i = Math.floor((x - box.min.x) / cell), j = Math.floor((y - box.min.y) / cell), k = Math.floor((z - box.min.z) / cell);
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : (k * ny + j) * nx + i;
  };

  // 1. Rasterize every triangle densely enough to leave no gaps. Sampling runs along the two
  //    edges from the corner that keeps the point count lowest, so thin slivers stay cheap.
  const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const step = cell * 0.5;
  let work = 0;
  for (const { mesh, m } of items) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index ? geo.index.array : null;
    const tris = idx ? idx.length / 3 : pos.count / 3;
    for (let t = 0; t < tris; t++) {
      for (let k = 0; k < 3; k++) corner[k].fromBufferAttribute(pos, idx ? idx[t * 3 + k] : t * 3 + k).applyMatrix4(m);
      let best = null;
      for (let k = 0; k < 3; k++) {
        const o = corner[k], p1 = corner[(k + 1) % 3], p2 = corner[(k + 2) % 3];
        const nu = Math.max(1, Math.ceil(o.distanceTo(p1) / step)), nw = Math.max(1, Math.ceil(o.distanceTo(p2) / step));
        if (!best || nu * nw < best[3] * best[4]) best = [o, p1, p2, nu, nw];
      }
      const [o, p1, p2, nu, nw] = best;
      for (let u = 0; u <= nu; u++) {
        for (let w = 0; w <= nw; w++) {
          const s1 = u / nu, s2 = w / nw;
          if (s1 + s2 > 1) break;
          const s0 = 1 - s1 - s2;
          const cIdx = cellOf(o.x * s0 + p1.x * s1 + p2.x * s2, o.y * s0 + p1.y * s1 + p2.y * s2, o.z * s0 + p1.z * s1 + p2.z * s2);
          if (cIdx >= 0) grid[cIdx] = 1;
        }
      }
      work += (nu + 1) * (nw + 1);
      if (work > 30000) { work = 0; yield; }
    }
  }

  // 2. Flood the outside from the grid's border; whatever the flood can't reach is inside an organ
  const OUT = 2;
  const queue = new Int32Array(nx * ny * nz);
  let head = 0, tail = 0;
  const push = (i) => { if (grid[i] === 0) { grid[i] = OUT; queue[tail++] = i; } };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { push((k * ny + j) * nx); push((k * ny + j) * nx + nx - 1); }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { push((k * ny) * nx + i); push((k * ny + ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { push(j * nx + i); push(((nz - 1) * ny + j) * nx + i); }
  yield;
  while (head < tail) {
    if (head % 40000 === 39999) yield;
    const i = queue[head++];
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
    if (x > 0) push(i - 1);
    if (x < nx - 1) push(i + 1);
    if (y > 0) push(i - nx);
    if (y < ny - 1) push(i + nx);
    if (z > 0) push(i - nx * ny);
    if (z < nz - 1) push(i + nx * ny);
  }
  const solid = (i) => i >= 0 && grid[i] !== OUT;

  // 3. Probe outward from each vertex over a cone around its normal
  const dirs = Array.from({ length: 32 }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / 32, r = Math.sqrt(1 - y * y), ang = i * 2.39996;
    return new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r);
  });
  const steps = [2.5, 4, 6, 9, 13].map((st) => st * cell);
  const n = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (const { mesh, m, nm } of items) {
    if (!mesh.material.vertexColors) continue;
    const geo = mesh.geometry;
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const colors = geo.attributes.color.array;
    for (let i = 0; i < pos.count; i++) {
      if (i % 250 === 249) yield;
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      let hit = 0, total = 0;
      for (const d of dirs) {
        const w = d.dot(n);
        if (w < 0.55) continue;
        for (let st = 0; st < steps.length; st++) {
          q.copy(v).addScaledVector(d, steps[st]);
          const fall = w * (1 - st / (steps.length + 1));
          total += fall;
          if (solid(cellOf(q.x, q.y, q.z)) || (floorY !== null && q.y < floorY)) hit += fall;
        }
      }
      const shade = 1 - strength * Math.pow(total ? hit / total : 0, 0.75);
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
    }
    geo.attributes.color.needsUpdate = true;
  }
}


export { THREE };
