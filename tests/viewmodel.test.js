import 'jest-canvas-mock';
import { AnnotationViewModel } from '../js/viewmodel.js';
import { AnnotationModel } from '../js/model.js';
import { AnnotationView } from '../js/view.js';
import { CanvasRenderer } from '../js/canvas-renderer.js';

describe('AnnotationViewModel', () => {
    let viewModel;
    let model;
    let view;
    let renderer;

    beforeEach(() => {
        const canvas = document.createElement('canvas');
        document.body.innerHTML = `
        <div id="canvasContainer">
            <canvas id="canvas"></canvas>
            <div id="placeholder"></div>
            <div id="loadingIndicator"></div>
            <button id="unloadImageBtn"></button>
            <div id="canvasControls"></div>
            <button id="resetViewBtn"></button>
        </div>
        <div id="toolsPanel">
            <button id="toolsToggleBtn"></button>
            <button id="addBoxBtn"></button>
            <button id="penToolBtn"></button>
            <button id="addTextBtn"></button>
        </div>
        <div id="propertiesPanel">
            <button id="propertiesToggleBtn"></button>
        </div>
        <input id="imageLoader" type="file" />
        <input id="jsonLoader" type="file" />
        <button id="uploadBtn"></button>
        <button id="exportBtn"></button>
        <button id="deleteBtn"></button>
        <input id="colorPicker" />
        <input id="fontSize" />
        <input id="fontSizeValueInput" />
        <button id="fontSizeDownBtn"></button>
        <button id="fontSizeUpBtn"></button>
        <input id="opacity" />
        <input id="opacityValueInput" />
        <button id="opacityDownBtn"></button>
        <button id="opacityUpBtn"></button>
        <div id="annotationList"></div>
        <button id="undoBtn"></button>
        <button id="redoBtn"></button>
        <div id="toastContainer"></div>
        <div id="exportModal">
            <button id="closeModalBtn"></button>
            <button id="copyToClipboardBtn"></button>
            <button id="saveToFileBtn"></button>
            <button id="saveJsonBtn"></button>
        </div>
        <button id="resetStylesBtn"></button>
        <select id="aspectRatioSelect"></select>
        <button id="drawSelectionBtn"></button>
        <button id="zoomInBtn"></button>
        <button id="zoomOutBtn"></button>
        <button id="fitToScreenBtn"></button>
        <div id="zoomLevelDisplay"></div>
        <div id="unloadConfirmModal">
            <button id="confirmUnloadBtn"></button>
            <button id="cancelUnloadBtn"></button>
        </div>
        <div id="helpModal">
            <button id="closeHelpModalBtn"></button>
        </div>
        `;
        model = new AnnotationModel();
        view = new AnnotationView(canvas);
        renderer = new CanvasRenderer(canvas, () => model.image, () => model.boxes, () => ({
            scale: model.scale,
            panX: model.panX,
            panY: model.panY,
            selectedBoxIds: model.selectedBoxIds,
            hoveredBoxId: null,
            selectionRect: model.selectionRect,
            drawingRect: null,
            tooltip: null,
            globalColor: model.globalColor,
            globalOpacity: model.globalOpacity,
            globalFontSize: model.globalFontSize,
        }));
        viewModel = new AnnotationViewModel(model, view, renderer);
    });

    it('should select a box', () => {
        model.addBox({ x: 10, y: 20, w: 30, h: 40 });
        viewModel.selectBox(0);
        expect(model.selectedBoxIds).toEqual([0]);
    });

    it('should delete a box', () => {
        const box = model.addBox({ x: 10, y: 20, w: 30, h: 40 });
        viewModel.selectBox(box.id);
        viewModel.deleteSelectedBoxes();
        expect(model.boxes.length).toBe(0);
    });

    it('should copy a box', () => {
        const box = model.addBox({ x: 10, y: 20, w: 30, h: 40 });
        viewModel.selectBox(box.id);
        viewModel.handleCopyAnnotation();
        expect(model.boxes.length).toBe(2);
    });

    it('should select all boxes', () => {
        model.addBox({ x: 10, y: 20, w: 30, h: 40 });
        model.addBox({ x: 50, y: 60, w: 70, h: 80 });
        viewModel.handleSelectAll();
        expect(model.selectedBoxIds.length).toBe(2);
    });

    it('should fit to screen', () => {
        const image = new Image();
        Object.defineProperty(image, 'naturalWidth', { value: 1000 });
        Object.defineProperty(image, 'naturalHeight', { value: 500 });
        model.image = image;
        const canvas = document.getElementById('canvas');
        canvas.width = 500;
        canvas.height = 250;
        viewModel.handleFitToScreen(canvas.width, canvas.height);
        expect(model.scale).toBe(0.5);
    });
});
