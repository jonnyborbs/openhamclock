/**
 * 3D satellite models for the globe projection.
 *
 * Two tiers:
 *  - The ISS renders as NASA's real model (public/models/iss.glb — NASA
 *    Visualization Technology Applications and Development (VTAD), decimated
 *    and meshopt-compressed from the 42 MB original to ~2 MB). Loaded on
 *    demand the first time the ISS is close enough to show, never in the
 *    main bundle.
 *  - Everything else renders as a procedural low-poly archetype built from
 *    three.js primitives: a GEO bird with a dish, a polar orbiter with a
 *    single long array, or a cubesat with paired wings. A few hundred
 *    triangles each, no downloads, Pi-friendly.
 *
 * Templates are built (or fetched) once per session and cached; callers
 * clone() them into the scene. Cloned groups share the template geometry
 * and materials, so scene teardown must not dispose them — Globe3D's
 * satellite-group cleanup only disposes direct children's own resources,
 * which model group roots do not have.
 */
import * as THREE from 'three';

export const SAT_MODEL_ATTRIBUTION = 'ISS model: NASA/VTAD';

/** Registry name → archetype. Names come from the satellite registry keys. */
export function classifySatellite(name) {
  const n = String(name || '').toUpperCase();
  if (n.startsWith('ISS')) return 'iss';
  // Geostationary: weather birds and QO-100 (amateur transponder on Es'hail-2).
  if (/^(GOES|EWS|ELEKTRO|GK-|HIMAWARI|QO-100|METEOSAT)/.test(n)) return 'geo';
  // Sun-synchronous polar orbiters.
  if (/^(METOP|METEOR|NOAA)/.test(n)) return 'polar';
  // Amateur birds, cubesats, everything else.
  return 'cubesat';
}

// ── Shared materials (never disposed — templates live for the session) ──
let mats = null;
const getMats = () => {
  if (mats) return mats;
  mats = {
    bus: new THREE.MeshLambertMaterial({ color: 0xb8bcc4, emissive: 0x22262c }),
    gold: new THREE.MeshLambertMaterial({ color: 0xc9a227, emissive: 0x33280a }),
    panel: new THREE.MeshLambertMaterial({ color: 0x1c3f9e, emissive: 0x0a1330, side: THREE.DoubleSide }),
    dish: new THREE.MeshLambertMaterial({ color: 0xe8e8e8, emissive: 0x303030, side: THREE.DoubleSide }),
    strut: new THREE.MeshLambertMaterial({ color: 0x666a70, emissive: 0x1a1c1e }),
  };
  return mats;
};

const panelWing = (w, h, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.015), m);

/** GEO bird: boxy bus, big offset dish, two solar wings on a yaw axis. */
function buildGeo() {
  const m = getMats();
  const g = new THREE.Group();
  const bus = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.22), m.gold);
  g.add(bus);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), m.dish);
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, 0, 0.17);
  g.add(dish);
  for (const side of [-1, 1]) {
    const wing = panelWing(0.55, 0.2, m.panel);
    wing.position.x = side * 0.44;
    g.add(wing);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6), m.strut);
    strut.rotation.z = Math.PI / 2;
    strut.position.x = side * 0.21;
    g.add(strut);
  }
  return g;
}

/** Polar orbiter: long bus, one big trailing array (METOP/NOAA silhouette). */
function buildPolar() {
  const m = getMats();
  const g = new THREE.Group();
  const bus = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.18), m.bus);
  g.add(bus);
  const scanner = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), m.gold);
  scanner.position.set(0.12, 0, 0.12);
  g.add(scanner);
  const wing = panelWing(0.24, 0.62, m.panel);
  wing.position.set(-0.3, 0.36, 0);
  g.add(wing);
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), m.strut);
  strut.position.set(-0.3, 0.04, 0);
  g.add(strut);
  return g;
}

/** Cubesat: small gold body, paired wings — the classic amateur bird. */
function buildCubesat() {
  const m = getMats();
  const g = new THREE.Group();
  const bus = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), m.gold);
  g.add(bus);
  for (const side of [-1, 1]) {
    const wing = panelWing(0.3, 0.16, m.panel);
    wing.position.x = side * 0.24;
    g.add(wing);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 5), m.strut);
  antenna.position.y = 0.17;
  g.add(antenna);
  return g;
}

/**
 * Trek theme easter egg: a procedural Constitution-class starship for the
 * 3D globe. Built nose along +Z, bridge along +Y, overall length ~1 so the
 * caller's constant-screen-size scaling treats it like the archetypes.
 * Cached template, cloned into the scene like everything else here.
 */
let enterprise = null;
export function getEnterpriseTemplate() {
  if (enterprise) return enterprise;
  const hull = new THREE.MeshLambertMaterial({ color: 0xd8dce4, emissive: 0x2a2e36 });
  const bussard = new THREE.MeshLambertMaterial({ color: 0xff4433, emissive: 0xcc2211 });
  const deflector = new THREE.MeshLambertMaterial({ color: 0xffc069, emissive: 0xb37a2e });
  const g = new THREE.Group();

  // Saucer section: shallow tapered disc + bridge dome
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.05, 28), hull);
  saucer.position.set(0, 0.1, 0.26);
  g.add(saucer);
  const bridge = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), hull);
  bridge.scale.y = 0.6;
  bridge.position.set(0, 0.14, 0.26);
  g.add(bridge);

  // Neck between saucer and engineering hull
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.14), hull);
  neck.rotation.x = 0.35;
  neck.position.set(0, 0.0, 0.09);
  g.add(neck);

  // Engineering hull: cylinder with a glowing deflector dish up front
  const engHull = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.42, 16), hull);
  engHull.rotation.x = Math.PI / 2;
  engHull.position.set(0, -0.1, -0.02);
  g.add(engHull);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), deflector);
  dish.position.set(0, -0.1, 0.2);
  g.add(dish);

  // Warp nacelles on angled pylons, red bussard collectors forward
  for (const side of [-1, 1]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.2, 0.08), hull);
    pylon.rotation.z = side * 0.7;
    pylon.position.set(side * 0.09, 0.0, -0.18);
    g.add(pylon);
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 14), hull);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(side * 0.17, 0.09, -0.18);
    g.add(nacelle);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), bussard);
    cap.position.set(side * 0.17, 0.09, 0.07);
    g.add(cap);
  }

  enterprise = g;
  return enterprise;
}

const archetypes = {};
export function getArchetypeTemplate(kind) {
  if (!archetypes[kind]) {
    archetypes[kind] = kind === 'geo' ? buildGeo() : kind === 'polar' ? buildPolar() : buildCubesat();
  }
  return archetypes[kind];
}

// ── ISS glb (lazy, cached, resilient) ──────────────────────
let issPromise = null;

/**
 * Resolves to a normalized template Group, or null on any failure — callers
 * fall back to the cubesat archetype so a blocked download never breaks the
 * layer. The rejection is cached-as-null; a reload retries.
 */
export function loadIssTemplate() {
  if (issPromise) return issPromise;
  issPromise = (async () => {
    try {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
      ]);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync('/models/iss.glb');
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) return null;
      // Normalize: center on origin, largest dimension = 1, so the caller's
      // constant-screen-size scaling treats it like the archetypes.
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const wrapper = new THREE.Group();
      root.position.sub(center);
      wrapper.add(root);
      wrapper.scale.setScalar(1 / maxDim);
      // Bake the normalization into a parent the caller can clone directly.
      const template = new THREE.Group();
      template.add(wrapper);
      return template;
    } catch (e) {
      console.warn('[Globe3D] ISS model unavailable, using archetype:', e?.message || e);
      return null;
    }
  })();
  return issPromise;
}
