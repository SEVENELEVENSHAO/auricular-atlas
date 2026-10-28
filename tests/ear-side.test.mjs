import test from 'node:test';
import assert from 'node:assert/strict';
import * as Three from 'three';

globalThis.T = Three;
const { EarViewer } = await import('../src/viewer.js');

test('right-side display mirrors coordinates without changing model-space data', () => {
  const viewer = Object.create(EarViewer.prototype);
  viewer.side = 'right';
  const point = [0.24, -0.13, 0.42];
  const displayed = viewer.toDisplayPoint(point);

  assert.deepEqual(displayed, [-0.24, -0.13, 0.42]);
  assert.deepEqual(viewer.toModelPoint(displayed), point);
  assert.deepEqual(point, [0.24, -0.13, 0.42]);

  const normal = new Three.Vector3(0.3, 0.4, Math.sqrt(0.75)).normalize();
  const displayedNormal = viewer.toDisplayPoint(normal);
  const restoredNormal = viewer.toModelNormal(displayedNormal);
  assert.ok(restoredNormal.distanceTo(normal) < 1e-12);
});

test('switching display side reflects only the viewer root', () => {
  const viewer = Object.create(EarViewer.prototype);
  viewer.side = 'left';
  viewer.displayRoot = new Three.Group();

  viewer.setSide('right');
  assert.equal(viewer.displayRoot.scale.x, -1);
  assert.equal(viewer.side, 'right');
  viewer.setSide('left');
  assert.equal(viewer.displayRoot.scale.x, 1);
  assert.equal(viewer.side, 'left');
  viewer.setSide('unknown');
  assert.equal(viewer.side, 'left');
});

test('screen projection mirrors left and right for arrays and Three.js vectors', () => {
  const viewer = Object.create(EarViewer.prototype);
  viewer.side = 'left';
  viewer.renderer = { domElement: { getBoundingClientRect: () => ({ left: 20, top: 30, width: 800, height: 600 }) } };
  viewer.camera = new Three.PerspectiveCamera(40, 4 / 3, 0.1, 100);
  viewer.camera.position.set(0, 0, 6);
  viewer.camera.lookAt(0, 0, 0);
  viewer.camera.updateProjectionMatrix();
  viewer.camera.updateMatrixWorld(true);
  const point = [0.22, 0.16, 0.1];
  const left = viewer.projectToScreen(point);
  viewer.side = 'right';
  const right = viewer.projectToScreen(new Three.Vector3(...point));

  assert.ok(Math.abs(left.x + right.x - 840) < 1e-8);
  assert.ok(Math.abs(left.y - right.y) < 1e-8);
});

test('raycasts from either displayed side return the same model-space hit and normal', () => {
  const viewer = Object.create(EarViewer.prototype);
  viewer.side = 'left';
  viewer.displayRoot = new Three.Group();
  viewer.meshes = [new Three.Mesh(new Three.SphereGeometry(0.5, 32, 24), new Three.MeshBasicMaterial())];
  viewer.meshes[0].position.x = 0.4;
  viewer.meshes[0].geometry.computeBoundsTree();
  viewer.displayRoot.add(viewer.meshes[0]);
  viewer.renderer = { domElement: { getBoundingClientRect: () => ({ left: 20, top: 30, width: 800, height: 600 }) } };
  viewer.camera = new Three.PerspectiveCamera(40, 4 / 3, 0.1, 100);
  viewer.camera.position.set(0, 0, 6);
  viewer.camera.lookAt(0, 0, 0);
  viewer.camera.updateProjectionMatrix();
  viewer.camera.updateMatrixWorld(true);
  viewer.ray = new Three.Raycaster();
  viewer.ray.firstHitOnly = true;
  viewer.displayRoot.updateMatrixWorld(true);

  const modelPoint = [0.4, 0, 0.5];
  const leftScreen = viewer.projectToScreen(modelPoint);
  const leftHit = viewer.hit(leftScreen.x, leftScreen.y);
  viewer.setSide('right');
  const rightScreen = viewer.projectToScreen(modelPoint);
  const rightHit = viewer.hit(rightScreen.x, rightScreen.y);

  assert.ok(leftHit);
  assert.ok(rightHit);
  assert.ok(new Three.Vector3(...leftHit.p).distanceTo(new Three.Vector3(...rightHit.p)) < 1e-6);
  assert.ok(new Three.Vector3(...leftHit.n).distanceTo(new Three.Vector3(...rightHit.n)) < 1e-6);
});
