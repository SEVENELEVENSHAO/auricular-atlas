import './style.css';
import { EarViewer } from './viewer.js';
import { readProject, saveProject, validateProject, readModel, saveModel, fingerprint } from './storage.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const base = import.meta.env.BASE_URL;
const lineThicknessValues = [1, 2, 3, 4, 5];
const lineThicknessSizes = [.014, .022, .03, .038, .046];
const starter = { id: 'solidhumans-left-v1', name: 'Human Ear', source: 'https://sketchfab.com/3d-models/human-ear-1d8dd0a5983a495781930644c3555adc', author: 'Vikrama Raghuraman', license: 'CC BY 4.0', status: 'Model source and CC BY 4.0 attribution' };

let project;
let book;
let viewer;
let selected = null;
let panel = '';
let prescription = null;
let highlight = [];
let history = [];
let moveId = null;
let refPage = 1;
let curveHistoryPending = false;
let nameEditId = null;
let nameEditOriginal = '';
let labelEditHistoryPending = false;
let editMode = false;
let inspectorSnapshot = false;
let pointMoveSnapshot = false;

const status = (text) => { $('#status').textContent = text; };
const allMarks = () => project ? [...project.points, ...project.markings, ...(project.naturalLines ?? [])] : [];
const current = () => allMarks().find((mark) => mark.id === selected);
const lineType = (mark) => mark.lineType ?? (mark.layer === 'naturalLines' ? 'natural' : 'perforated');
const lineThickness = (mark) => Math.max(1, Math.min(5, Number(mark.thickness) || 3));
const lineSize = (thickness) => lineThicknessSizes[Math.max(1, Math.min(5, Number(thickness) || 3)) - 1];

function snapshot() {
  history.push(JSON.stringify(project));
  if (history.length > 40) history.shift();
}

function beginInspectorEdit() {
  if (!inspectorSnapshot) {
    snapshot();
    inspectorSnapshot = true;
  }
}

function commit() {
  try {
    saveProject(project);
    status(`Saved on this browser · ${project.points.length} points · ${project.markings.length + (project.naturalLines ?? []).length} lines`);
  } catch (error) {
    status(`Save failed. Export a backup now. ${error.message}`);
  }
  inspectorSnapshot = false;
  pointMoveSnapshot = false;
  draw();
}

function cancelInspectorEdit() {
  if (!inspectorSnapshot) return;
  inspectorSnapshot = false;
  if (history.length) project = JSON.parse(history.pop());
  draw();
}

function cancelPointMove() {
  if (pointMoveSnapshot && history.length) project = JSON.parse(history.pop());
  pointMoveSnapshot = false;
  viewer.stopPointMove();
  moveId = null;
  draw();
}

function discardPendingLabelEdit() {
  if (!labelEditHistoryPending) return;
  labelEditHistoryPending = false;
  if (history.length) project = JSON.parse(history.pop());
  draw();
}

function draw() {
  if (!viewer || !project) return;
  viewer.renderAnnotations(project, selected, highlight);
  updateOverlays();
}

function setMode(mode) {
  viewer.setMode(mode);
  const hint = {
    orbit: 'Drag to rotate · Scroll to zoom · Right-drag to pan',
    point: 'Click and drag on the ear to place a point',
    line: 'Drag from the start point to the end point',
    label: 'Click the ear to place a floating label',
    'curve-edit': 'Drag the curve nodes or handles along the ear surface',
    'point-move': 'Drag the selected green point to move it'
  }[mode] ?? 'Drag on the ear';
  $('#mode-hint').textContent = hint;
  document.querySelectorAll('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.mode === mode));
  updateOverlays();
}

function openNameEditor(mark) {
  nameEditId = mark.id;
  nameEditOriginal = mark.name ?? '';
  const input = $('#annotation-name-input');
  const editor = $('#annotation-editor');
  $('#annotation-editor-title').textContent = mark.kind === 'point' ? 'Name point' : 'Name label';
  input.value = mark.name ?? '';
  input.placeholder = mark.kind === 'point' ? 'e.g. Shenmen' : 'Type label text';
  editor.hidden = false;
  updateAnnotationEditor();
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

function closeNameEditor(save = false) {
  const mark = nameEditId && current();
  if (mark && !save) mark.name = nameEditOriginal;
  if (save) commit();
  nameEditId = null;
  nameEditOriginal = '';
  $('#annotation-editor').hidden = true;
  draw();
}

function updateAnnotationEditor() {
  const editor = $('#annotation-editor');
  if (!editor || editor.hidden || !nameEditId || panel !== 'editor' || !project) return;
  const mark = current();
  if (!mark || mark.id !== nameEditId || !mark.anchors?.[0]) { editor.hidden = true; return; }
  const point = viewer.markScreenPosition(mark);
  const width = editor.offsetWidth || 236;
  const height = editor.offsetHeight || 130;
  editor.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, point.x + 18))}px`;
  editor.style.top = `${Math.max(12, Math.min(window.innerHeight - height - 12, point.y - height / 2))}px`;
}

function updateMarkInspectorPosition() {
  const inspector = $('#mark-inspector');
  if (!project) return;
  const mark = current();
  if (!inspector || inspector.hidden || !mark || !editMode) return;
  const point = viewer.markScreenPosition(mark);
  const width = inspector.offsetWidth || 286;
  const height = inspector.offsetHeight || 360;
  const gap = mark.kind === 'point' ? 104 : 64;
  inspector.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, point.x + gap))}px`;
  inspector.style.top = `${Math.max(12, Math.min(window.innerHeight - height - 12, point.y - 36))}px`;
}

function updateLabelEditor() {
  const overlay = $('#label-edit-overlay');
  if (!overlay || !project) return;
  const mark = current();
  const show = editMode && panel === 'editor' && viewer.visible.labels && !nameEditId && mark?.anchors?.length && (mark.kind === 'label' || (mark.kind === 'point' && mark.name));
  if (!show) { overlay.hidden = true; return; }
  const geometry = viewer.labelScreenGeometry(mark);
  if (!geometry) { overlay.hidden = true; return; }
  const left = Math.max(8, Math.min(window.innerWidth - 8, geometry.left));
  const top = Math.max(8, Math.min(window.innerHeight - 8, geometry.top));
  overlay.hidden = false;
  overlay.setAttribute('aria-label', mark.kind === 'point' ? 'Adjust point label' : 'Edit selected label');
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${Math.max(28, Math.min(window.innerWidth - left - 8, geometry.width))}px`;
  overlay.style.height = `${Math.max(28, Math.min(window.innerHeight - top - 8, geometry.height))}px`;
}

function updateOverlays() {
  updateAnnotationEditor();
  updateMarkInspectorPosition();
  updateLabelEditor();
}

function selectMark(id) {
  if (!editMode) {
    status('Turn on Edit mode to select and edit a marking.');
    return;
  }
  discardPendingLabelEdit();
  if (viewer.curveEdit) viewer.stopCurveEdit();
  selected = id;
  const mark = current();
  if (mark?.kind === 'point') {
    viewer.startPointMove(mark);
    setMode('point-move');
    status('Point selected · drag the green point to move it.');
  } else {
    viewer.stopPointMove();
    setMode('orbit');
  }
  renderEditor();
  draw();
}

function setEditMode(value) {
  editMode = value;
  if (!editMode) {
    cancelInspectorEdit();
    cancelPointMove();
    selected = null;
    setMode('orbit');
  }
  renderEditor();
  draw();
  status(editMode ? 'Edit mode on · select a point, line, or label on the ear.' : 'Edit mode off · choose a create tool to place a new marking.');
}

function showPanel(name) {
  if (name !== 'editor') {
    if (nameEditId) closeNameEditor(false);
    cancelInspectorEdit();
    cancelPointMove();
    if (viewer?.curveEdit) viewer.stopCurveEdit();
    setMode('orbit');
  }
  panel = name;
  $('#drawer').hidden = false;
  $('#drawer-title').textContent = ({ library: 'Prescriptions', editor: 'Surface editor', project: 'Atlas project' })[name];
  if (name === 'library') renderLibrary();
  else if (name === 'editor') renderEditor();
  else renderProject();
}

function lineTypeOptions(mark) {
  if (mark.kind !== 'line') return '';
  return `<label class="field">Line type<select id="inspector-line-type"><option value="perforated" ${lineType(mark) === 'perforated' ? 'selected' : ''}>Perforated line</option><option value="natural" ${lineType(mark) === 'natural' ? 'selected' : ''}>Natural line</option></select></label>`;
}

function renderMarkInspector() {
  const inspector = $('#mark-inspector');
  const mark = current();
  if (!inspector || !editMode || panel !== 'editor' || !mark || nameEditId) {
    if (inspector) inspector.hidden = true;
    return;
  }
  const isLine = mark.kind === 'line' || mark.kind === 'area';
  const isPoint = mark.kind === 'point';
  const thickness = lineThickness(mark);
  const markSize = Number(mark.size ?? .035).toFixed(3);
  inspector.innerHTML = `<header><strong>${esc(mark.kind === 'point' ? 'Edit point' : mark.kind === 'label' ? 'Edit label' : 'Edit line')}</strong><button id="mark-inspector-close" aria-label="Close editor">×</button></header>
    <div class="inspector-body">
      <label class="field">Name<textarea id="inspector-name" rows="2" maxlength="100">${esc(mark.name ?? '')}</textarea></label>
      <div class="row"><label class="field">Colour<input id="inspector-color" type="color" value="${mark.color ?? '#70ced4'}"></label>${isPoint ? `<label class="field">Point size<input id="inspector-size" type="number" min="0.01" max="0.12" step="0.005" value="${markSize}"></label>` : mark.kind === 'label' ? `<label class="field">Font size<div class="stepper"><button type="button" data-size-step="-1" aria-label="Decrease font size">-</button><input id="inspector-size" type="text" inputmode="decimal" value="${markSize}" readonly aria-label="Font size"><button type="button" data-size-step="1" aria-label="Increase font size">+</button></div></label>` : ''}</div>
      ${lineTypeOptions(mark)}
      ${isLine ? `<fieldset class="field thickness-field"><legend>Line thickness</legend><div class="segmented" id="inspector-thickness">${lineThicknessValues.map((value) => `<button type="button" data-thickness="${value}" aria-pressed="${value === thickness}">${value}</button>`).join('')}</div></fieldset>` : ''}
      ${mark.kind === 'label' ? `<label class="field">Label rotation<input id="inspector-rotation" type="number" min="-180" max="180" step="5" value="${mark.labelRotation ?? 0}"></label>` : ''}
      <details class="inspector-details"><summary>Metadata</summary><label class="field">Notes<textarea id="inspector-notes" rows="3">${esc(mark.notes ?? '')}</textarea></label><label class="field">Review status<select id="inspector-review"><option value="pending" ${mark.review !== 'reviewed' ? 'selected' : ''}>Pending review</option><option value="reviewed" ${mark.review === 'reviewed' ? 'selected' : ''}>Reviewed by me</option></select></label></details>
      ${isLine && mark.kind === 'line' ? `<div class="row"><button id="inspector-edit-curve">Edit curve</button><button id="inspector-move">Move line</button></div>` : mark.kind === 'label' ? '<p class="muted">Drag the center or corner handle on the label to move, resize, or rotate it.</p>' : ''}
      <div class="row"><button id="inspector-save" class="primary">Save edits</button><button id="inspector-cancel">Cancel</button></div>
      <button id="inspector-delete" class="wide danger">Delete selected marking</button>
    </div>`;
  inspector.hidden = false;
  updateMarkInspectorPosition();

  const mutate = (callback) => { beginInspectorEdit(); callback(); draw(); };
  $('#inspector-name').oninput = (event) => mutate(() => { mark.name = event.currentTarget.value.split(/\r?\n/).slice(0, 2).join('\n'); });
  $('#inspector-color').oninput = (event) => mutate(() => { mark.color = event.currentTarget.value; });
  $('#inspector-size')?.addEventListener('input', (event) => mutate(() => { mark.size = Math.max(.01, Math.min(.12, Number(event.currentTarget.value) || .035)); }));
  $('#inspector-rotation')?.addEventListener('input', (event) => mutate(() => { mark.labelRotation = Math.max(-180, Math.min(180, Number(event.currentTarget.value) || 0)); }));
  $('#inspector-line-type')?.addEventListener('change', (event) => mutate(() => { moveLineLayer(mark, event.currentTarget.value); }));
  document.querySelectorAll('[data-thickness]').forEach((button) => button.onclick = () => mutate(() => { mark.thickness = Number(button.dataset.thickness); mark.size = lineSize(mark.thickness); renderMarkInspector(); }));
  document.querySelectorAll('[data-size-step]').forEach((button) => button.onclick = () => mutate(() => { mark.size = Math.max(.01, Math.min(.12, Number(mark.size ?? .035) + Number(button.dataset.sizeStep) * .005)); renderMarkInspector(); }));
  $('#inspector-notes')?.addEventListener('input', (event) => mutate(() => { mark.notes = event.currentTarget.value; }));
  $('#inspector-review')?.addEventListener('change', (event) => mutate(() => { mark.review = event.currentTarget.value; }));
  $('#inspector-save').onclick = () => { inspectorSnapshot = false; commit(); renderEditor(); };
  $('#inspector-cancel').onclick = () => { cancelInspectorEdit(); renderEditor(); };
  $('#mark-inspector-close').onclick = () => { cancelInspectorEdit(); selected = null; viewer.stopPointMove(); renderEditor(); draw(); };
  $('#inspector-delete').onclick = () => deleteMark(mark);
  $('#inspector-move')?.addEventListener('click', () => { moveId = mark.id; setMode('line'); status('Drag from the new start point to the new end point.'); });
  $('#inspector-edit-curve')?.addEventListener('click', () => { viewer.startCurveEdit(mark); setMode('curve-edit'); draw(); renderMarkInspector(); status('Curve edit active. Drag a node or handle along the ear surface.'); });
}

function moveLineLayer(mark, type) {
  if (mark.kind !== 'line') return;
  const target = type === 'natural' ? 'naturalLines' : 'markings';
  project.naturalLines ??= [];
  for (const list of [project.markings, project.naturalLines]) {
    const index = list.indexOf(mark);
    if (index >= 0) list.splice(index, 1);
  }
  project[target].push(mark);
  mark.layer = target;
  mark.lineType = type;
}

function renderEditor() {
  const marks = allMarks();
  $('#panel-content').innerHTML = `<p class="muted">Create a marking first. Turn on Edit mode to select and style a saved point, line, or label.</p>
    <div class="editor-actions"><button data-create="point">Create point</button><button data-create="line">Create line</button><button data-create="label">Create label</button><button id="edit-mode-toggle" class="edit-toggle" aria-pressed="${editMode}">${editMode ? 'Edit mode on' : 'Edit mode off'}</button></div>
    <p class="editor-state ${editMode ? 'active' : ''}">${editMode ? 'Select a marking on the ear or from the saved list.' : 'Create tools are ready. Editing is off.'}</p>
    <div class="row"><button id="deselect" class="wide">Clear selection</button><button id="undo" class="wide" ${history.length ? '' : 'disabled'}>Undo</button></div>
    <h3>Saved layers</h3><div class="list">${marks.map((mark) => `<button data-select="${mark.id}" class="${mark.id === selected ? 'selected' : ''}">${esc(mark.name || 'Untitled')}<small>${mark.kind === 'point' ? 'Ear point' : mark.layer === 'naturalLines' ? 'Natural line' : mark.kind === 'label' ? 'Surface label' : 'Perforated line'} · ${esc(mark.review ?? 'pending')}</small></button>`).join('') || '<p class="muted">No markings yet. Create a point, line, or label on the ear.</p>'}</div>`;
  document.querySelectorAll('[data-create]').forEach((button) => button.onclick = () => {
    cancelInspectorEdit();
    cancelPointMove();
    selected = null;
    moveId = null;
    if (viewer.curveEdit) viewer.stopCurveEdit();
    setMode(button.dataset.create);
    draw();
  });
  $('#edit-mode-toggle').onclick = () => setEditMode(!editMode);
  document.querySelectorAll('[data-select]').forEach((button) => button.onclick = () => selectMark(button.dataset.select));
  $('#deselect').onclick = () => { cancelInspectorEdit(); cancelPointMove(); selected = null; moveId = null; if (viewer.curveEdit) viewer.stopCurveEdit(); setMode('orbit'); renderEditor(); draw(); };
  $('#undo').onclick = undo;
  renderMarkInspector();
}

function saveCurveEdit() {
  const mark = current();
  const curve = viewer.getCurveEdit();
  if (!mark || !curve) return;
  mark.curve = curve;
  mark.anchors = viewer.flattenCurve(curve);
  curveHistoryPending = false;
  commit();
  renderEditor();
}

function deleteMark(mark) {
  if (!inspectorSnapshot) snapshot();
  inspectorSnapshot = false;
  project.points = project.points.filter((item) => item.id !== mark.id);
  project.markings = project.markings.filter((item) => item.id !== mark.id);
  project.naturalLines = (project.naturalLines ?? []).filter((item) => item.id !== mark.id);
  for (const combination of Object.values(project.combinations)) combination.pointIds = combination.pointIds.filter((id) => id !== mark.id);
  selected = null;
  viewer.stopPointMove();
  if (viewer.curveEdit) viewer.stopCurveEdit();
  commit();
  renderEditor();
}

function undo() {
  if (!history.length) return;
  if (viewer.curveEdit) viewer.stopCurveEdit();
  if (viewer.labelGesture) viewer.endLabelGesture();
  viewer.stopPointMove();
  curveHistoryPending = false;
  inspectorSnapshot = false;
  pointMoveSnapshot = false;
  closeNameEditor(false);
  project = JSON.parse(history.pop());
  selected = null;
  commit();
  if (panel === 'editor') renderEditor();
  else if (panel === 'library') renderPrescription();
}

function createData(kind) {
  return { name: kind === 'line' ? 'Untitled line' : '', color: kind === 'point' ? '#e23b46' : '#70ced4', size: .035, labelRotation: 0, page: null, thickness: 3, lineType: 'perforated' };
}

function onAction(action) {
  if (!project) return;
  if (action.kind === 'select') {
    if (!editMode) { status('Turn on Edit mode to select and edit a marking.'); return; }
    const result = viewer.nearestMark(action.anchor, allMarks());
    if (result?.mark && result.distance < .12) selectMark(result.mark.id);
    return;
  }
  if (action.kind === 'point-move-change') {
    const mark = current();
    if (!mark || mark.kind !== 'point') return;
    if (!pointMoveSnapshot) { snapshot(); pointMoveSnapshot = true; }
    mark.anchors = [action.anchor];
    draw();
    return;
  }
  if (action.kind === 'point-move-end') {
    if (pointMoveSnapshot) { pointMoveSnapshot = false; commit(); renderEditor(); }
    return;
  }
  if (action.kind === 'label-begin') {
    beginInspectorEdit();
    status(action.mark?.kind === 'point' ? 'Point label position pending. Click Save edits to keep it.' : 'Label change pending. Click Save edits to keep it.');
    return;
  }
  if (action.kind === 'label-change') {
    if (action.mark?.id === selected) {
      if ($('#inspector-size')) $('#inspector-size').value = String(action.mark.size);
      if ($('#inspector-rotation')) $('#inspector-rotation').value = String(Math.round(action.mark.labelRotation ?? 0));
    }
    draw();
    return;
  }
  if (action.kind === 'label-end') { updateLabelEditor(); return; }
  if (action.kind === 'curve-begin') { curveHistoryPending = false; draw(); status('Drag the selected node or handle along the ear surface.'); return; }
  if (action.kind === 'curve-change') { if (!curveHistoryPending) { snapshot(); curveHistoryPending = true; } draw(); return; }
  if (action.kind === 'curve-end') { if (curveHistoryPending) saveCurveEdit(); return; }

  snapshot();
  const isPath = ['line', 'natural-line', 'area'].includes(action.kind);
  const nameAfterPlacement = ['point', 'label'].includes(action.kind);
  let mark;
  if (moveId) {
    mark = allMarks().find((item) => item.id === moveId);
    if (mark) { mark.anchors = action.anchors; delete mark.curve; }
    selected = moveId;
    moveId = null;
  } else {
    const data = createData(action.kind === 'natural-line' ? 'line' : action.kind);
    const natural = action.kind === 'natural-line';
    mark = { id: crypto.randomUUID(), kind: natural ? 'line' : action.kind, layer: natural ? 'naturalLines' : 'markings', ...data, name: nameAfterPlacement ? '' : data.name, review: 'pending', notes: '', anchors: action.anchors };
    if (action.kind === 'point') project.points.push(mark);
    else if (natural) { project.naturalLines ??= []; project.naturalLines.push(mark); }
    else project.markings.push(mark);
    selected = mark.id;
  }
  if (isPath && mark) {
    mark.curve = viewer.buildCurve(mark);
    viewer.startCurveEdit(mark);
    setMode('curve-edit');
  } else setMode('orbit');
  commit();
  showPanel('editor');
  if (nameAfterPlacement) openNameEditor(mark);
  else if (isPath) status('Line created. Turn on Edit mode to name or style it.');
}

function renderLibrary() {
  prescription = null;
  highlight = [];
  draw();
  $('#panel-content').innerHTML = `<p class="muted">Lichun Huang & William S. Huang<br>Prescriptions & Formulae · 2007</p><span class="pill">${book.prescriptions.length} indexed topics · pending review</span><label class="field">Search prescriptions<input id="search" class="search" placeholder="Condition, function or page"></label><label class="field">Section<select id="category"><option value="">All sections</option>${[...new Set(book.prescriptions.map((item) => item.category))].map((category) => `<option>${esc(category)}</option>`).join('')}</select></label><small>Topics link to the original scan. Formula variants and point combinations are added separately.</small><span id="result-count" class="count"></span><div id="results" class="list"></div>`;
  const filter = () => { const query = $('#search').value.toLowerCase(); const category = $('#category').value; const rows = book.prescriptions.filter((item) => (!category || item.category === category) && `${item.title} ${item.printedPage}`.toLowerCase().includes(query)); $('#result-count').textContent = `${rows.length} topics`; $('#results').innerHTML = rows.map((item) => `<button data-rx="${item.id}">${esc(item.title)}<small>${esc(item.category)} · p. ${item.printedPage}</small></button>`).join('') || '<p>No matching topics.</p>'; document.querySelectorAll('[data-rx]').forEach((button) => button.onclick = () => { prescription = book.prescriptions.find((item) => item.id === button.dataset.rx); renderPrescription(); }); };
  $('#search').oninput = filter;
  $('#category').onchange = filter;
  filter();
}

function renderPrescription() {
  if (!prescription) return renderLibrary();
  const item = prescription;
  const combination = project.combinations[item.id] ?? { pointIds: [], notes: '', review: 'pending' };
  highlight = combination.pointIds;
  draw();
  $('#panel-content').innerHTML = `<button id="all-rx">← All prescriptions</button><h3>${esc(item.title)}</h3><small>${esc(item.category)} · printed p. ${item.printedPage} · PDF spread ${item.pdfPage}</small><button id="source" class="primary wide">Open book page ${item.printedPage}</button><div class="notice">Index pending source review. Read the original page before recording a combination. Supplementary points and techniques may be conditional.</div><h3>Point combination</h3><p class="muted">Select saved ear points to highlight this combination on the atlas.</p><div class="list">${project.points.map((point) => `<label class="check"><input type="checkbox" data-link="${point.id}" ${combination.pointIds.includes(point.id) ? 'checked' : ''}>${esc(point.name)} <small>(${esc(point.review)})</small></label>`).join('') || '<p class="notice">No ear points placed yet. Add them in Edit atlas, then link them here.</p>'}</div><label class="field">Source notes / conditional points<textarea id="rx-notes">${esc(combination.notes)}</textarea></label><button id="save-rx" class="wide">Save combination</button><button id="clear-highlight" class="wide">Clear highlight</button><small class="count">${combination.pointIds.length} linked points · ${combination.review} combination</small>`;
  $('#all-rx').onclick = renderLibrary;
  $('#source').onclick = () => openReference(item.printedPage);
  $('#clear-highlight').onclick = () => { highlight = []; draw(); };
  $('#save-rx').onclick = () => { snapshot(); project.combinations[item.id] = { pointIds: [...document.querySelectorAll('[data-link]:checked')].map((input) => input.dataset.link), notes: $('#rx-notes').value, review: 'pending', source: item.source }; highlight = project.combinations[item.id].pointIds; commit(); renderPrescription(); };
}

function openReference(page) {
  refPage = Math.max(1, Math.min(313, page));
  $('#reference-title').textContent = `Book · printed page ${refPage}`;
  $('#reference-image').src = `${base}reference/page-${refPage}.jpg`;
  $('#reference').hidden = false;
}

function renderProject() {
  const model = project.model;
  $('#panel-content').innerHTML = `<h3>Active ear mesh</h3><p>${esc(model.name)}</p><small>${Math.round(viewer.triangles).toLocaleString()} triangles · ${esc(model.status ?? 'Imported model')}</small>${model.author || model.license ? `<p class="muted">${esc(model.author ?? 'Unknown author')}${model.license ? ` · ${esc(model.license)}` : ''}</p>` : ''}${model.source ? `<p><a href="${esc(model.source)}" target="_blank" rel="noopener">Model source & attribution</a></p>` : ''}<div class="notice">This preview keeps the full ear relief and removes only a small amount from the far outer head slab. The original GLB is kept in the project backup. Each model keeps its own markings.</div><label class="field">Import ear model (GLB, STL or OBJ)<input id="model-file" type="file" accept=".glb,.stl,.obj"></label><p class="muted">The model is saved in this browser. Keep the original file with your project backup.</p><h3>Save & restore</h3><p class="muted">Edits auto-save locally. Export a backup to keep or move your points, markings and combinations.</p><button id="export" class="primary wide">Export atlas JSON</button><label class="field" style="margin-top:16px">Restore atlas backup<input id="import" type="file" accept=".json"></label><button id="restore-starter" class="wide">Restore bundled ear model</button><h3>Reference</h3><p class="muted">${book.prescriptions.length} indexed topics. Point locations and combinations remain pending. The book scans stay local and are excluded from the web build.</p>`;
  $('#export').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `auricular-atlas-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
  $('#import').onchange = async (event) => { const file = event.target.files[0]; if (!file) return; try { const data = validateProject(JSON.parse(await file.text()), project.model.id); snapshot(); project = data; selected = null; commit(); status('Atlas backup restored.'); } catch (error) { status(error.message); } };
  $('#model-file').onchange = async (event) => { const file = event.target.files[0]; if (!file) return; status('Loading and indexing model surface…'); try { const buffer = await file.arrayBuffer(); const id = await fingerprint(buffer); const format = file.name.split('.').pop().toLowerCase(); const metadata = { id, name: file.name, status: 'Imported · anatomy review pending' }; await viewer.load(buffer, format); await saveModel({ buffer, format, metadata }); project = readProject(metadata); history = []; selected = null; highlight = []; commit(); renderProject(); } catch (error) { status(`Could not load model: ${error.message}`); } };
  $('#restore-starter').onclick = async () => { await loadStarter(); await saveModel(null); renderProject(); };
}

async function loadStarter() {
  const buffer = await (await fetch(`${base}models/ear.glb`)).arrayBuffer();
  await viewer.load(buffer, 'glb', true);
  project = readProject(starter);
  project.model = { ...starter };
  saveProject(project);
  history = [];
  selected = null;
  highlight = [];
  draw();
  status('Human Ear model · CC BY 4.0 by Vikrama Raghuraman');
}

document.querySelectorAll('[data-panel]').forEach((button) => button.onclick = () => showPanel(button.dataset.panel));
$('#close-drawer').onclick = () => { if (nameEditId) closeNameEditor(false); cancelInspectorEdit(); cancelPointMove(); selected = null; editMode = false; if (viewer.curveEdit) viewer.stopCurveEdit(); $('#drawer').hidden = true; setMode('orbit'); draw(); };
$('#front').onclick = () => viewer.fit();
$('#back').onclick = () => viewer.fit(true);
$('#fit').onclick = () => viewer.fit();
for (const key of ['markings', 'naturalLines', 'points', 'labels']) $(`#${key}-toggle`).onclick = (event) => { viewer.visible[key] = !viewer.visible[key]; event.currentTarget.setAttribute('aria-pressed', viewer.visible[key]); draw(); };
$('#annotation-name-input').oninput = (event) => { const mark = current(); if (!mark || mark.id !== nameEditId) return; mark.name = event.currentTarget.value.split(/\r?\n/).slice(0, 2).join('\n'); draw(); };
$('#annotation-name-save').onclick = () => { closeNameEditor(true); if (panel === 'editor') renderEditor(); };
$('#mark-inspector').addEventListener('pointerdown', (event) => event.stopPropagation());
$('#label-edit-overlay').addEventListener('pointerdown', (event) => { const mark = current(); if (!editMode || !mark || mark.kind !== 'label' || nameEditId) return; event.preventDefault(); event.stopPropagation(); const type = event.target.closest('#label-edit-corner') ? 'corner' : 'move'; event.currentTarget.setPointerCapture?.(event.pointerId); viewer.startLabelGesture(mark, type, event.clientX, event.clientY); });
window.addEventListener('pointermove', (event) => { if (!viewer?.labelGesture) return; event.preventDefault(); viewer.updateLabelGesture(event.clientX, event.clientY); });
window.addEventListener('pointerup', () => { if (viewer?.labelGesture) { viewer.endLabelGesture(); updateLabelEditor(); } });
window.addEventListener('pointercancel', () => { if (viewer?.labelGesture) { viewer.endLabelGesture(); updateLabelEditor(); } });
$('#ref-prev').onclick = () => openReference(refPage - 1);
$('#ref-next').onclick = () => openReference(refPage + 1);
$('#ref-close').onclick = () => { $('#reference').hidden = true; };
$('#reference-image').onerror = () => status('Book page unavailable. Run the local reference server or regenerate the reference images.');
window.addEventListener('resize', updateOverlays);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (nameEditId) { closeNameEditor(false); if (panel === 'editor') renderEditor(); return; }
    cancelInspectorEdit();
    cancelPointMove();
    if (viewer.curveEdit) viewer.stopCurveEdit();
    if (viewer.labelGesture) viewer.endLabelGesture();
    curveHistoryPending = false;
    setMode('orbit');
    draw();
    if (panel === 'editor') renderEditor();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); undo(); }
});

try {
  book = await (await fetch(`${base}data/prescriptions.json`)).json();
  viewer = new EarViewer($('#stage'), onAction);
  viewer.onFrame = updateOverlays;
  const stored = await readModel();
  if (stored) { await viewer.load(stored.buffer, stored.format); project = readProject(stored.metadata); draw(); status('Atlas restored from this browser.'); }
  else await loadStarter();
} catch (error) {
  status(`Atlas could not load: ${error.message}`);
}
