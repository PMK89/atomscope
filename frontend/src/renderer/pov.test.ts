import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  Sprite,
  Vector3,
} from 'three';
import { expect, test } from 'vitest';
import { cylinderMatrix } from './math';
import { PovWriter, povScene, writeObject } from './pov';

const options = {
  aspect: 1.5,
  background: new Color(1, 1, 1),
  light: new Vector3(1, 1.5, 2),
};

/** The numbers of every `sphere { <...>, r` in the source. */
const spheres = (pov: string): number[][] =>
  [...pov.matchAll(/sphere \{\s*<([^>]*)>, ([\d.eE+-]+)/g)].map((m) => [
    ...m[1]!.split(',').map(Number),
    Number(m[2]),
  ]);

const cylinders = (pov: string): number[][] =>
  [...pov.matchAll(/cylinder \{\s*<([^>]*)>, <([^>]*)>, ([\d.eE+-]+)/g)].map((m) => [
    ...m[1]!.split(',').map(Number),
    ...m[2]!.split(',').map(Number),
    Number(m[3]),
  ]);

test('an instanced sphere mesh comes out as one sphere per instance, in world space', () => {
  const mesh = new InstancedMesh(new SphereGeometry(1, 8, 6), new MeshStandardMaterial(), 2);
  mesh.setMatrixAt(
    0,
    new Matrix4().compose(new Vector3(1, 2, 3), new Quaternion(), new Vector3(0.4, 0.4, 0.4)),
  );
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(-1, 0, 0));
  // the group carries a transform: the export must be in the frame the viewer sees
  const group = new Group();
  group.position.set(0, 10, 0);
  group.add(mesh);
  const scene = new Scene();
  scene.add(group);
  scene.updateMatrixWorld(true);

  const out = new PovWriter();
  writeObject(out, scene);
  const found = spheres(out.toString());
  expect(found).toEqual([
    [1, 12, 3, 0.4],
    [-1, 10, 0, 1],
  ]);
});

test('a cylinder instance comes back as the two ends it was built from', () => {
  const a = new Vector3(0, 0, 0);
  const b = new Vector3(1.5, 0.5, -0.25);
  const mesh = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8), new MeshStandardMaterial(), 1);
  mesh.setMatrixAt(0, cylinderMatrix(a, b, 0.12, new Matrix4()));
  const scene = new Scene();
  scene.add(mesh);
  scene.updateMatrixWorld(true);

  const out = new PovWriter();
  writeObject(out, scene);
  const [row] = cylinders(out.toString());
  expect(row).toBeDefined();
  // the ends come back in the order the matrix put them, which may be either way round
  const ends = [row!.slice(0, 3), row!.slice(3, 6)];
  const near = ends.find((p) => Math.hypot(p[0]! - a.x, p[1]! - a.y, p[2]! - a.z) < 1e-6);
  const far = ends.find((p) => Math.hypot(p[0]! - b.x, p[1]! - b.y, p[2]! - b.z) < 1e-6);
  expect(near).toBeDefined();
  expect(far).toBeDefined();
  expect(row![6]).toBeCloseTo(0.12, 6);
});

test('a cone keeps its apex, and a sprite or an invisible layer contributes nothing', () => {
  const cone = new Mesh(new ConeGeometry(1, 1, 12), new MeshStandardMaterial());
  cone.scale.set(0.2, 2, 0.2);
  cone.position.set(0, 1, 0);
  const hidden = new Mesh(new SphereGeometry(1), new MeshStandardMaterial());
  hidden.visible = false;
  const scene = new Scene();
  scene.add(cone, hidden, new Sprite());
  scene.updateMatrixWorld(true);

  const out = new PovWriter();
  writeObject(out, scene);
  const text = out.toString();
  // base at y = 0, apex at y = 2: the cone points the way three.js draws it
  expect(text).toMatch(/cone \{\s*<0, 0, 0>, 0.2, <0, 2, 0>, 0/);
  expect(text).not.toContain('sphere');
  expect(out.length).toBe(1);
});

test('a triangle mesh keeps its faces and takes the mean of its vertex colours', () => {
  const out = new PovWriter();
  out.mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], new Color(0.5, 0.25, 0));
  const text = out.toString();
  expect(text).toContain('vertex_vectors { 3,');
  expect(text).toContain('<0, 0, 0>, <1, 0, 0>, <0, 1, 0>');
  expect(text).toContain('face_indices { 1,');
  expect(text).toContain('rgbt <0.5, 0.25, 0, 0>');
  // fewer than three points is not a mesh
  const empty = new PovWriter();
  empty.mesh([0, 0, 0], null, new Color());
  expect(empty.length).toBe(0);
});

test('a mesh carries its normals, so a surface is not exported faceted', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setIndex([0, 1, 2]);
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: new Color(0, 0, 1) }));
  // a quarter turn about x sends +z to -y, and the normals must come with it
  mesh.rotateX(Math.PI / 2);
  const scene = new Scene();
  scene.add(mesh);
  scene.updateMatrixWorld(true);

  const out = new PovWriter();
  writeObject(out, scene);
  const text = out.toString();
  expect(text).toContain('normal_vectors { 3,');
  expect(text).toContain('<0, -1, 0>, <0, -1, 0>, <0, -1, 0>');
  expect(text).toContain('normal_indices { 1,');
  // the material colour, since this material does not read the vertex colours
  expect(text).toContain('rgbt <0, 0, 1, 0>');
});

test('the scene block carries the camera basis, the background and one light', () => {
  const camera = new PerspectiveCamera(45, 1.5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  const pov = povScene(new Scene(), camera, { ...options, background: new Color(0, 0, 0) });
  expect(pov).toContain('background { color rgb <0, 0, 0> }');
  expect(pov).toContain('  perspective');
  // the field of view is in the vector lengths: |up| = 1, |right| = aspect, and a direction of
  // 1 / (2 tan(fov/2)) -- 1.207107 at 45 degrees. No `angle`, which would depend on line order.
  expect(pov).not.toContain('angle');
  expect(pov).toContain('  direction <0, 0, -1> * 1.207107');
  expect(pov).toContain('  location <0, 0, 10>');
  // looking down -z, with x to the right and y up
  expect(pov).toContain('  right <1, 0, 0> * 1.5');
  expect(pov).toContain('  up <0, 1, 0>');
  expect(pov).toContain('  parallel');

  const ortho = new OrthographicCamera(-2, 2, 1, -1, 0.1, 100);
  ortho.position.set(0, 0, 5);
  ortho.lookAt(0, 0, 0);
  const orthoPov = povScene(new Scene(), ortho, options);
  expect(orthoPov).toContain('  orthographic');
  // the frustum width and height are the camera vectors of an orthographic POV camera
  expect(orthoPov).toContain('  right <4, 0, 0>');
  expect(orthoPov).toContain('  up <0, 2, 0>');
  // an orthographic camera takes its extent from those two vectors, so the direction is a unit
  expect(orthoPov).toContain('  direction <0, 0, -1>\n');
});
