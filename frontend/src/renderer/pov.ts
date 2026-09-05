/**
 * POV-Ray scene export (Avogadro's POVPainter, `libavogadro/src/extensions/povpainter.cpp`).
 *
 * Avogadro implements a Painter interface twice, once for OpenGL and once for POV-Ray, and every
 * engine draws through it. Atomscope draws through three.js instead, so the export reads the
 * scene that was actually drawn: whatever the layers put there -- periodic images, multiple-bond
 * offsets, the colours a colour scheme wrote per instance -- is what the file gets, and there is
 * no second description of the picture to drift from the first.
 *
 * What is exported: instanced and plain spheres, cylinders and cones, and triangle meshes
 * (ribbons, isosurfaces). What is not: sprites (the labels), line segments (the unit-cell box)
 * and the axes gizmo, which is drawn in a separate overlay pass and is not part of the scene.
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

export interface PovOptions {
  /** width / height of the image the scene is written for; POV needs it in the camera */
  aspect: number;
  /** background colour, as the viewport shows it */
  background: Color;
  /** direction the key light shines from, in world space */
  light: Vector3;
}

const v = (x: number, y: number, z: number): string => `<${n(x)}, ${n(y)}, ${n(z)}>`;

/** Six digits is below what any renderer resolves and keeps the file readable. */
const n = (x: number): string => (Object.is(x, -0) ? '0' : Number(x.toFixed(6)).toString());

const vec = (p: Vector3): string => v(p.x, p.y, p.z);

const pigment = (color: Color, alpha: number): string =>
  `pigment { rgbt <${n(color.r)}, ${n(color.g)}, ${n(color.b)}, ${n(1 - alpha)}> }`;

const FINISH = 'finish { ambient 0.25 diffuse 0.75 specular 0.2 roughness 0.02 }';

/** Collects the primitives of a scene as POV-Ray source. */
export class PovWriter {
  private readonly parts: string[] = [];

  sphere(center: Vector3, radius: number, color: Color, alpha = 1): void {
    if (radius <= 0) return;
    this.parts.push(
      `sphere {\n  ${vec(center)}, ${n(radius)}\n  ${pigment(color, alpha)}\n  ${FINISH}\n}`,
    );
  }

  cylinder(a: Vector3, b: Vector3, radius: number, color: Color, alpha = 1): void {
    if (radius <= 0 || a.distanceTo(b) < 1e-9) return;
    this.parts.push(
      `cylinder {\n  ${vec(a)}, ${vec(b)}, ${n(radius)}\n  ${pigment(color, alpha)}\n  ${FINISH}\n}`,
    );
  }

  cone(base: Vector3, radius: number, apex: Vector3, color: Color, alpha = 1): void {
    if (radius <= 0 || base.distanceTo(apex) < 1e-9) return;
    this.parts.push(
      `cone {\n  ${vec(base)}, ${n(radius)}, ${vec(apex)}, 0\n  ${pigment(color, alpha)}\n  ${FINISH}\n}`,
    );
  }

  /**
   * A triangle mesh. POV's `mesh2` colours a face at a time, so a per-vertex colour array is
   * flattened to its mean: a ribbon exported this way is one colour, which is the honest
   * simplification (POV-Ray does not interpolate vertex pigments without one texture per vertex).
   */
  mesh(
    positions: ArrayLike<number>,
    indices: ArrayLike<number> | null,
    color: Color,
    alpha = 1,
  ): void {
    const count = positions.length / 3;
    if (count < 3) return;
    const points: string[] = [];
    for (let i = 0; i < count; i++)
      points.push(v(positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!));
    const faces: string[] = [];
    if (indices) {
      for (let i = 0; i + 2 < indices.length; i += 3)
        faces.push(v(indices[i]!, indices[i + 1]!, indices[i + 2]!));
    } else {
      for (let i = 0; i + 2 < count; i += 3) faces.push(v(i, i + 1, i + 2));
    }
    if (faces.length === 0) return;
    this.parts.push(
      `mesh2 {\n  vertex_vectors { ${points.length},\n    ${points.join(', ')}\n  }\n` +
        `  face_indices { ${faces.length},\n    ${faces.join(', ')}\n  }\n` +
        `  ${pigment(color, alpha)}\n  ${FINISH}\n}`,
    );
  }

  get length(): number {
    return this.parts.length;
  }

  toString(): string {
    return this.parts.join('\n\n');
  }
}

/** The horizontal field of view, in degrees, of a camera with vertical `fov` at `aspect`. */
function horizontalFov(fov: number, aspect: number): number {
  return (2 * Math.atan(aspect * Math.tan((fov * Math.PI) / 360)) * 180) / Math.PI;
}

const matrix = new Matrix4();
const position = new Vector3();
const quaternion = new Quaternion();
const scale = new Vector3();
const axis = new Vector3();
const color = new Color();

type Primitive = 'sphere' | 'cylinder' | 'cone' | null;

function primitiveOf(mesh: Mesh | InstancedMesh): Primitive {
  const g = mesh.geometry;
  if (g instanceof SphereGeometry) return 'sphere';
  // a cone is a cylinder in three.js's class hierarchy, so it has to be tested first
  if (g instanceof ConeGeometry) return 'cone';
  if (g instanceof CylinderGeometry) return 'cylinder';
  return null;
}

/**
 * One instance, as a primitive. The geometries the layers use are unit-sized and centred on the
 * origin along +Y (`cylinderMatrix` composes translation = midpoint, scale = radius, length,
 * radius), so the endpoints come back out of the decomposition.
 */
function emitPrimitive(
  out: PovWriter,
  kind: Exclude<Primitive, null>,
  world: Matrix4,
  paint: Color,
  alpha: number,
): void {
  world.decompose(position, quaternion, scale);
  // an instance a layer never wrote (or wrote as a degenerate cylinder) is not on screen either
  if (scale.lengthSq() < 1e-12) return;
  if (kind === 'sphere') {
    out.sphere(position, Math.max(scale.x, scale.y, scale.z), paint, alpha);
    return;
  }
  axis.set(0, scale.y / 2, 0).applyQuaternion(quaternion);
  const a = position.clone().sub(axis);
  const b = position.clone().add(axis);
  const radius = Math.max(scale.x, scale.z);
  if (kind === 'cylinder') out.cylinder(a, b, radius, paint, alpha);
  // ConeGeometry's apex is at +height/2, its base at -height/2
  else out.cone(a, radius, b, paint, alpha);
}

function meshColor(mesh: Mesh): Color {
  const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
  const attribute = mesh.geometry.getAttribute('color');
  const base =
    'color' in material && material.color instanceof Color ? material.color : new Color(1, 1, 1);
  // a geometry may still carry a colour attribute the material has stopped reading
  if (!material.vertexColors || !attribute || attribute.count === 0) return base.clone();
  // the mean of the vertex colours: see `PovWriter.mesh`
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < attribute.count; i++) {
    r += attribute.getX(i);
    g += attribute.getY(i);
    b += attribute.getZ(i);
  }
  return new Color(r / attribute.count, g / attribute.count, b / attribute.count);
}

function opacityOf(mesh: Mesh | InstancedMesh): number {
  const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
  return material.transparent ? material.opacity : 1;
}

/** Walk the visible part of a scene, writing every primitive it holds. */
export function writeObject(out: PovWriter, object: Object3D): void {
  if (!object.visible) return;
  if (object instanceof InstancedMesh) {
    const kind = primitiveOf(object);
    const alpha = opacityOf(object);
    const material = Array.isArray(object.material) ? object.material[0]! : object.material;
    const fallback =
      'color' in material && material.color instanceof Color ? material.color : color;
    if (kind) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        matrix.premultiply(object.matrixWorld);
        // instanceColor is only there once a layer has painted the instances
        if (object.instanceColor) object.getColorAt(i, color);
        else color.copy(fallback);
        emitPrimitive(out, kind, matrix, color, alpha);
      }
    }
  } else if (object instanceof Mesh) {
    const kind = primitiveOf(object);
    const paint = meshColor(object);
    const alpha = opacityOf(object);
    if (kind) emitPrimitive(out, kind, object.matrixWorld, paint, alpha);
    else {
      const positions = object.geometry.getAttribute('position');
      const index = object.geometry.getIndex();
      if (positions) {
        const world = new Float32Array(positions.count * 3);
        for (let i = 0; i < positions.count; i++) {
          position.set(positions.getX(i), positions.getY(i), positions.getZ(i));
          position.applyMatrix4(object.matrixWorld);
          world[3 * i] = position.x;
          world[3 * i + 1] = position.y;
          world[3 * i + 2] = position.z;
        }
        out.mesh(world, index ? index.array : null, paint, alpha);
      }
    }
  }
  for (const child of object.children) writeObject(out, child);
}

/**
 * The scene block: the background, the camera and one parallel light, in the shape Avogadro's
 * POV painter writes them.
 *
 * POV-Ray's default coordinate system is left-handed, but a camera whose `right`, `up` and
 * `direction` are given explicitly defines its own frame, so a right-handed scene comes out
 * un-mirrored -- which is why there is no negated x anywhere here.
 */
export function povHeader(
  camera: PerspectiveCamera | OrthographicCamera,
  options: PovOptions,
): string {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const right = new Vector3(e[0]!, e[1]!, e[2]!);
  const up = new Vector3(e[4]!, e[5]!, e[6]!);
  const direction = new Vector3(-e[8]!, -e[9]!, -e[10]!);
  const location = new Vector3(e[12]!, e[13]!, e[14]!);
  const light = options.light.clone().normalize().multiplyScalar(1000);
  const bg = options.background;

  const projection =
    camera instanceof PerspectiveCamera
      ? [
          '  perspective',
          // POV-Ray's `angle` is the *horizontal* field of view once `right` is given, and
          // three.js's `fov` is the vertical one. Avogadro passes its vertical angle straight
          // through, which makes its exports slightly too wide; this converts instead.
          `  angle ${n(horizontalFov(camera.fov, options.aspect))}`,
          `  up ${vec(up)}`,
          `  right ${vec(right)} * ${n(options.aspect)}`,
        ]
      : [
          '  orthographic',
          `  up ${vec(up.clone().multiplyScalar(camera.top - camera.bottom))}`,
          `  right ${vec(right.clone().multiplyScalar(camera.right - camera.left))}`,
        ];

  return [
    '// Atomscope POV-Ray export. Render with: povray +A +W1600 +H1200 scene.pov',
    '#version 3.7;',
    '',
    'global_settings {',
    '  assumed_gamma 1.0',
    '  ambient_light rgb <0.25, 0.25, 0.25>',
    '  max_trace_level 15',
    '}',
    '',
    `background { color rgb ${v(bg.r, bg.g, bg.b)} }`,
    '',
    'camera {',
    ...projection,
    `  location ${vec(location)}`,
    `  direction ${vec(direction)}`,
    '}',
    '',
    'light_source {',
    `  ${vec(light)}`,
    '  color rgb <1, 1, 1>',
    '  parallel',
    `  point_at ${vec(light.clone().negate())}`,
    '}',
    '',
  ].join('\n');
}

/** The whole file: header, then every primitive of the scene. */
export function povScene(
  scene: Object3D,
  camera: PerspectiveCamera | OrthographicCamera,
  options: PovOptions,
): string {
  scene.updateMatrixWorld(true);
  const out = new PovWriter();
  writeObject(out, scene);
  return `${povHeader(camera, options)}\n${out.toString()}\n`;
}
