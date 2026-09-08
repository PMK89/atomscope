/**
 * The rubbersheet: a field cut drawn as a height field you can turn.
 *
 * `paw_wave.x` writes a gnuplot script that draws this as a static 3D surface, and `asecppaw`'s
 * `rubberSheet` redraws it in matplotlib with a `LightSource`. Here it is a real scene, so the
 * "view" parameters the file suggests -- gnuplot's `rot_x`/`rot_z`, and matplotlib's vertical
 * exaggeration -- become sliders and a drag rather than numbers to edit and re-render.
 *
 * The surface is lit rather than flat-shaded: the shape of a density peak is only legible when
 * the light rakes across it, which is exactly why the reference implementation shades it too.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  BufferAttribute,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { PlaneField } from '../../api/client';
import { cppawColor } from '../charts/contour';
import { scaledField, type ContourScale } from './ContourPlot';

/** Height of the surface at full exaggeration, relative to the plane's own width. */
const RELIEF = 0.55;

/** Degrees above the sheet the camera starts at. Low enough that relief reads as relief. */
const ELEVATION = 28;

export interface RubberSheetProps {
  plane: PlaneField;
  /** Same scale as the contour: the two are one field, and a cusp flattens both alike. */
  scale?: ContourScale;
  height?: number;
}

export function RubberSheet({
  plane,
  scale = 'linear',
  height = 300,
}: RubberSheetProps): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const mesh = useRef<Mesh | null>(null);
  const light = useRef<DirectionalLight | null>(null);
  // the file's own suggested view is where the sliders start; `view` is optional in the schema
  // because an older plane may not carry one, and the writer's defaults stand in for it
  const view = plane.view ?? { rot_x: 30, rot_z: 20, scale: 1.8, scale_z: 1 };
  const [exaggeration, setExaggeration] = useState(view.scale_z ?? 1);
  const [azimuth, setAzimuth] = useState(270);
  const [elevation, setElevation] = useState(45);

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;

    const width = el.clientWidth || 320;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    el.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(45, width / height, 0.01, 100);
    // gnuplot's rot_x is a tilt away from looking straight down, so the file's 30 asks for a 60
    // degree elevation -- nearly overhead, where a height field shows no height at all. That is
    // fine for a printed figure beside a contour plot and wrong for a scene you can turn, so the
    // camera starts at a three-quarter view instead and rot_z still sets which way round it is.
    const tilt = (ELEVATION * Math.PI) / 180;
    const turn = ((view.rot_z ?? 20) * Math.PI) / 180;
    const r = 2.2;
    camera.position.set(
      r * Math.cos(tilt) * Math.sin(turn),
      r * Math.sin(tilt),
      r * Math.cos(tilt) * Math.cos(turn),
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const nx = plane.nx;
    const ny = plane.ny;
    const geometry = new PlaneGeometry(1, 1, nx - 1, ny - 1);
    const colors = new Float32Array(nx * ny * 3);
    geometry.setAttribute('color', new BufferAttribute(colors, 3));

    const surface = new Mesh(
      geometry,
      new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, flatShading: false }),
    );
    // PlaneGeometry lies in xy; lay it down so its normal is up and z becomes the height
    surface.rotation.x = -Math.PI / 2;
    scene.add(surface);
    mesh.current = surface;

    const sun = new DirectionalLight(0xffffff, 2.2);
    scene.add(sun);
    scene.add(new AmbientLight(0xffffff, 0.55));
    light.current = sun;

    let running = true;
    const frame = (): void => {
      if (!running) return;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    };
    frame();

    const onResize = (): void => {
      const w = el.clientWidth || width;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height, false);
    };
    window.addEventListener('resize', onResize);

    return () => {
      running = false;
      window.removeEventListener('resize', onResize);
      controls.dispose();
      geometry.dispose();
      surface.material.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      mesh.current = null;
      light.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plane, height]);

  /** Displace and recolour the vertices. Runs on every exaggeration change, so it allocates none. */
  useEffect(() => {
    const surface = mesh.current;
    if (!surface) return;
    const { nx, ny } = plane;
    const { shown, lo, hi } = scaledField(plane.values, scale);
    const span = hi - lo || 1;

    const pos = surface.geometry.getAttribute('position') as BufferAttribute;
    const col = surface.geometry.getAttribute('color') as BufferAttribute;
    const c = new Color();
    // PlaneGeometry runs its rows along x, so vertex (ix, iy) is at iy * nx + ix
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const t = (shown[ix]![iy]! - lo) / span;
        const k = iy * nx + ix;
        pos.setZ(k, t * RELIEF * exaggeration);
        c.set(cppawColor(t));
        col.setXYZ(k, c.r, c.g, c.b);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    surface.geometry.computeVertexNormals();
  }, [plane, exaggeration, scale]);

  /** The light source, as an azimuth and elevation -- matplotlib's `LightSource(270, 45)`. */
  useEffect(() => {
    const sun = light.current;
    if (!sun) return;
    const a = (azimuth * Math.PI) / 180;
    const e = (elevation * Math.PI) / 180;
    sun.position.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
  }, [azimuth, elevation]);

  return (
    <>
      <div ref={host} className="rubber-sheet" style={{ height }} />
      <div className="form-row">
        <label htmlFor="rs-exag">relief ×{exaggeration.toFixed(1)}</label>
        <input
          id="rs-exag"
          type="range"
          min="0"
          max="4"
          step="0.1"
          value={exaggeration}
          onChange={(e) => setExaggeration(Number(e.target.value))}
        />
      </div>
      <div className="form-row">
        <label htmlFor="rs-az">light azimuth {azimuth}°</label>
        <input
          id="rs-az"
          type="range"
          min="0"
          max="360"
          step="5"
          value={azimuth}
          onChange={(e) => setAzimuth(Number(e.target.value))}
        />
      </div>
      <div className="form-row">
        <label htmlFor="rs-el">light elevation {elevation}°</label>
        <input
          id="rs-el"
          type="range"
          min="0"
          max="90"
          step="5"
          value={elevation}
          onChange={(e) => setElevation(Number(e.target.value))}
        />
      </div>
      <p className="muted">Drag to turn the sheet; wheel to zoom.</p>
    </>
  );
}
