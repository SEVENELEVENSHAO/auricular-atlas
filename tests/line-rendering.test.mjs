import test from 'node:test';
import assert from 'node:assert/strict';
import * as Three from 'three';
import { EarViewer } from '../src/viewer.js';

const anchor = (x, y = 0) => ({ p: [x, y, 0], n: [0, 0, 1], mesh: 0 });
const viewer = () => {
  const instance = Object.create(EarViewer.prototype);
  instance.meshes = [];
  instance.curveRay = new Three.Raycaster();
  instance.overlays = new Three.Group();
  instance.visible = { markings: true, naturalLines: true, points: true, labels: true };
  return instance;
};

test('draws a ribbon with two vertices per supplied surface sample', () => {
  const instance = viewer();
  const path = [anchor(0), anchor(.2), anchor(.4, .08)];

  instance.surfaceStroke(path, '#70ced4', 3);

  const stroke = instance.overlays.children[0];
  const positions = stroke.geometry.getAttribute('position');
  const first = new Three.Vector3().fromBufferAttribute(positions, 0);
  const second = new Three.Vector3().fromBufferAttribute(positions, 1);

  assert.ok(stroke.isMesh);
  assert.equal(positions.count, path.length * 2);
  assert.ok(Math.abs(first.z - .016) < 1e-6);
  assert.ok(Math.abs(second.z - .016) < 1e-6);
  assert.ok(Math.abs(first.distanceTo(second) - .005) < 1e-6);
  assert.equal(stroke.geometry.index.count, (path.length - 1) * 6);
});

test('line creation keeps only the start and latest end while dragging', () => {
  const instance = viewer();
  const start = anchor(0);
  instance.drawing = [start];

  for (let i = 1; i <= 1000; i++) instance.setPathEnd(anchor(i / 1000));

  assert.equal(instance.drawing.length, 2);
  assert.equal(instance.drawing[0], start);
  assert.equal(instance.drawing[1].p[0], 1);
});

test('builds direction-continuous handles for drawn line curves', () => {
  const instance = viewer();
  const anchors = [[0, 0, 0], [.1, .04, 0], [.2, 0, 0], [.3, .06, 0]]
    .map(([x,y,z]) => ({ p:[x,y,z],n:[0,0,1],mesh:0 }));
  const curve = instance.buildCurve({ anchors });
  const knots = curve.runs[0].knots;

  for (const knot of knots.slice(1, -1)) {
    const point = new Three.Vector3(...knot.anchor.p);
    const incoming = point.clone().sub(new Three.Vector3(...knot.inHandle.p));
    const outgoing = new Three.Vector3(...knot.outHandle.p).sub(point);
    assert.ok(incoming.distanceTo(outgoing) < 1e-9);
  }
});

test('keeps smooth curve samples independent of mesh contour raycasts', () => {
  const instance = viewer();
  const line = { anchors: [anchor(0), anchor(.2, .04)] };
  line.curve = instance.buildCurve(line);
  instance.projectCurveSample = () => { throw new Error('curve sample should not snap to mesh contour'); };

  const [path] = instance.curvePaths(line);

  assert.equal(path.length, 13);
  assert.deepEqual(path[0].p, line.anchors[0].p);
  assert.deepEqual(path.at(-1).p, line.anchors[1].p);
  assert.ok(path.every(point => point.n.every(Number.isFinite)));
});

test('does not resample or raycast the already sampled curve path again', () => {
  const instance = viewer();
  const path = Array.from({ length: 200 }, (_, i) => anchor(i * .001, Math.sin(i / 10) * .01));
  let projections = 0;
  instance.projectCurveSample = () => { projections++; throw new Error('unexpected extra surface raycast'); };

  const geometry = instance.flatLineGeometry(path, 3);

  assert.equal(projections, 0);
  assert.equal(geometry.getAttribute('position').count, path.length * 2);
  assert.equal(geometry.index.count, (path.length - 1) * 6);
});

test('renders flat and perforated marks as one mesh with real dash gaps', () => {
  const instance = viewer();
  for (const lineType of ['flat', 'perforated']) {
    const line = { id: lineType, kind: 'line', layer: 'markings', lineType, color: '#70ced4', thickness: 3,
      anchors: [anchor(0), anchor(.2), anchor(.4, .08)] };
    line.curve = instance.buildCurve(line);
    instance.renderAnnotations({ points: [], markings: [line], naturalLines: [] }, null);
    assert.equal(instance.overlays.children.length, 1);
    assert.ok(instance.overlays.children[0].isMesh);
    const renderedVertices=instance.overlays.children[0].geometry.getAttribute('position').count;
    const continuousVertices=instance.curvePaths(line).reduce((total, run) => total + run.length * 2, 0);
    if(lineType==='flat')assert.equal(renderedVertices,continuousVertices);
    else {
      assert.ok(renderedVertices <= continuousVertices + 20, 'dashes should add only their endpoints, not dense resampling');
      assert.ok(instance.overlays.children[0].geometry.index.count < (continuousVertices / 2 - 1) * 6, 'dash gaps should omit connecting triangles');
    }
    instance.clear();
  }
});
