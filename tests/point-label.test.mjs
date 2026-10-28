import test from 'node:test';
import assert from 'node:assert/strict';
import * as Three from 'three';

globalThis.T = Three;
const { EarViewer } = await import('../src/viewer.js');

function makeViewer() {
  const viewer = Object.create(EarViewer.prototype);
  viewer.onAction = () => {};
  viewer.projectToScreen = (point) => {
    const x = Array.isArray(point) ? point[0] : point.x;
    const y = Array.isArray(point) ? point[1] : point.y;
    return {
      x: 400 + x * 1000,
      y: 300 - y * 1000,
      z: 0
    };
  };
  viewer.hit = (x, y) => ({
    p: [(x - 400) / 1000, (300 - y) / 1000, 0],
    n: [0, 0, 1],
    mesh: 0
  });
  return viewer;
}

function makePoint() {
  return {
    id: 'point',
    kind: 'point',
    name: 'Shenmen',
    size: 0.035,
    labelSize: 0.045,
    labelRotation: 0,
    anchors: [{ p: [0, 0, 0], n: [0, 0, 1], mesh: 0 }]
  };
}

test('rotating a point label keeps its center and font size fixed', () => {
  const viewer = makeViewer();
  const mark = makePoint();
  const initial = viewer.pointLabelPlacement(mark.anchors[0], mark.name, mark.labelSize, mark.size, mark.labelRotation);
  const center = viewer.projectToScreen(initial.position.toArray());

  viewer.startLabelGesture(mark, 'corner', center.x + 50, center.y);
  viewer.updateLabelGesture(center.x, center.y + 50);

  const rotated = viewer.pointLabelPlacement(mark.anchors[0], mark.name, mark.labelSize, mark.size, mark.labelRotation);
  assert.ok(rotated.position.distanceTo(initial.position) < 1e-9);
  assert.equal(Math.round(mark.labelRotation), -90);

  const resizedMark = makePoint();
  const resizeStart = viewer.pointLabelPlacement(resizedMark.anchors[0], resizedMark.name, resizedMark.labelSize, resizedMark.size, resizedMark.labelRotation);
  const resizeCenter = viewer.projectToScreen(resizeStart.position.toArray());
  viewer.startLabelGesture(resizedMark, 'corner', resizeCenter.x + 50, resizeCenter.y);
  viewer.updateLabelGesture(resizeCenter.x + 75, resizeCenter.y);
  const resized = viewer.pointLabelPlacement(resizedMark.anchors[0], resizedMark.name, resizedMark.labelSize, resizedMark.size, resizedMark.labelRotation, resizedMark.labelOffset);
  assert.ok(resized.position.distanceTo(resizeStart.position) < 1e-9);
  assert.equal(resizedMark.labelSize, 0.045);
});

test('dragging the point label area moves the point anchor', () => {
  const viewer = makeViewer();
  const actions = [];
  viewer.onAction = (action) => actions.push(action);
  const mark = makePoint();

  viewer.startPointDrag(mark, 1);
  viewer.updatePointDrag(450, 250, 1);
  viewer.endPointDrag(1);

  assert.deepEqual(mark.anchors[0].p, [0.05, 0.05, 0]);
  assert.deepEqual(actions.map(({ kind }) => kind), ['point-move-change', 'point-move-end']);
});

test('curve editor controls stay compact while the selected knot remains distinct', () => {
  const viewer = Object.create(EarViewer.prototype);
  viewer.overlays = new Three.Group();
  viewer.curveSelection = { runIndex: 0, knotIndex: 0 };
  viewer.curvePoint = (knot) => knot.anchor.p;
  const curve = { runs: [{ knots: [
    { anchor: { p: [0, 0, 0] }, inHandle: { p: [-0.1, 0, 0] }, outHandle: { p: [0.1, 0, 0] } },
    { anchor: { p: [1, 0, 0] }, inHandle: { p: [0.9, 0, 0] }, outHandle: { p: [1.1, 0, 0] } }
  ] }] };

  viewer.renderCurveEditor(curve);
  const radii = viewer.overlays.children.filter((object) => object.isMesh).map((object) => object.geometry.parameters.radius);

  assert.deepEqual(radii, [0.034, 0.018, 0.018, 0.024, 0.018, 0.018]);
});

test('label handles use the projected center and rotated corner', () => {
  const viewer = makeViewer();
  const mark = { ...makePoint(), labelRotation: 45 };
  const geometry = viewer.pointLabelScreenGeometry(mark);
  const placement = viewer.pointLabelPlacement(mark.anchors[0], mark.name, mark.labelSize, mark.size, mark.labelRotation);
  const expectedCorner = viewer.projectToScreen(
    placement.position.clone()
      .addScaledVector(placement.x, placement.width / 2)
      .addScaledVector(placement.y, placement.height / 2)
  );

  assert.ok(Math.hypot(geometry.center.x - viewer.projectToScreen(placement.position).x, geometry.center.y - viewer.projectToScreen(placement.position).y) < 1e-9);
  assert.ok(Math.hypot(geometry.corner.x - expectedCorner.x, geometry.corner.y - expectedCorner.y) < 1e-9);
  assert.ok(Math.hypot(geometry.corner.x - (geometry.left + geometry.width), geometry.corner.y - geometry.top) > 1);
});

test('moving a point label applies pointer movement from the drag start', () => {
  const viewer = makeViewer();
  const mark = makePoint();
  const initial = viewer.pointLabelPlacement(mark.anchors[0], mark.name, mark.labelSize, mark.size, mark.labelRotation);
  const center = viewer.projectToScreen(initial.position.toArray());
  const initialOffset = [...initial.offset];

  viewer.startLabelGesture(mark, 'move', center.x, center.y);
  viewer.updateLabelGesture(center.x + 5, center.y);

  assert.ok(Math.abs(mark.labelOffset[0] - (initialOffset[0] + 0.005)) < 1e-9);
  assert.ok(Math.abs(mark.labelOffset[1] - initialOffset[1]) < 1e-9);
});

test('migrating a rotated point label preserves its current placement', () => {
  const viewer = makeViewer();
  const mark = { ...makePoint(), labelRotation: 45, labelOffset: [0.02, 0.08] };
  const oldOffset = mark.labelOffset;
  const rotation = mark.labelRotation * Math.PI / 180;
  const oldAxes = viewer.labelAxes(new Three.Vector3(0, 0, 1), mark.labelRotation);
  const before = new Three.Vector3(...mark.anchors[0].p)
    .addScaledVector(oldAxes.x, oldOffset[0])
    .addScaledVector(oldAxes.y, oldOffset[1]);

  viewer.migratePointLabelOffset(mark);
  const after = viewer.pointLabelPlacement(mark.anchors[0], mark.name, mark.labelSize, mark.size, mark.labelRotation, mark.labelOffset).position;

  assert.ok(Math.abs(mark.labelOffset[0] - (oldOffset[0] * Math.cos(rotation) - oldOffset[1] * Math.sin(rotation))) < 1e-9);
  assert.ok(Math.abs(mark.labelOffset[1] - (oldOffset[0] * Math.sin(rotation) + oldOffset[1] * Math.cos(rotation))) < 1e-9);
  assert.ok(after.distanceTo(before.clone().addScaledVector(new Three.Vector3(0, 0, 1), viewer.pointDomeRadius(mark.size) + 0.006)) < 1e-9);
  assert.equal(mark.labelOffsetBasis, 'tangent');
  const migratedOffset = [...mark.labelOffset];
  viewer.migratePointLabelOffset(mark);
  assert.deepEqual(mark.labelOffset, migratedOffset);
});

test('migrating a rotated default point label preserves its current placement', () => {
  const viewer = makeViewer();
  const mark = { ...makePoint(), labelRotation: 45 };
  const normal = new Three.Vector3(...mark.anchors[0].n).normalize();
  const oldAxes = viewer.labelAxes(normal, mark.labelRotation);
  const defaultY = viewer.labelMetrics(mark.name, mark.labelSize).height / 2 + viewer.pointDomeRadius(mark.size) + 0.012;
  const before = new Three.Vector3(...mark.anchors[0].p)
    .addScaledVector(normal, viewer.pointDomeRadius(mark.size) + 0.006)
    .addScaledVector(oldAxes.y, defaultY);

  viewer.migratePointLabelOffset(mark);
  const after = viewer.pointLabelPlacement(mark.anchors[0], mark.name, mark.labelSize, mark.size, mark.labelRotation, mark.labelOffset).position;

  assert.ok(after.distanceTo(before) < 1e-9);
  assert.equal(mark.labelOffsetBasis, 'tangent');
});

test('moving a point label falls back to screen movement when surface hits are missing', () => {
  const viewer = makeViewer();
  const mark = makePoint();
  const initial = viewer.pointLabelPlacement(mark.anchors[0], mark.name, mark.labelSize, mark.size, mark.labelRotation);
  const center = viewer.projectToScreen(initial.position.toArray());
  viewer.hit = () => null;

  viewer.startLabelGesture(mark, 'move', center.x, center.y);
  viewer.updateLabelGesture(center.x + 5, center.y);

  assert.ok(Math.abs(mark.labelOffset[0] - (initial.offset[0] + 0.005)) < 1e-9);
  assert.ok(Math.abs(mark.labelOffset[1] - initial.offset[1]) < 1e-9);
});
