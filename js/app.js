// js/app.js

/**
 * @file app.js
 * @description This is the main entry point for the application. It initializes the
 * Model, View, ViewModel, and Renderer, and wires them together.
 */

// Import all modules
import { AnnotationModel } from './model.js';
import { AnnotationView } from './view.js';
import { AnnotationViewModel } from './viewmodel.js';
import { CanvasRenderer } from './canvas-renderer.js';

/**
 * @description Main function that runs when the DOM is fully loaded.
 * It sets up the entire application.
 */
document.addEventListener('DOMContentLoaded', () => {
    /**
     * @type {HTMLCanvasElement}
     * @description The main canvas element where annotations are drawn.
     */
    const canvas = document.getElementById("canvas");

    /**
     * @type {AnnotationModel}
     * @description The instance of the data model.
     */
    const model = new AnnotationModel();

    /**
     * @type {AnnotationView}
     * @description The instance of the view, which handles DOM manipulation.
     */
    const view = new AnnotationView(canvas); 

    /**
     * @type {CanvasRenderer}
     * @description The instance of the renderer, responsible for all drawing on the canvas.
     * It is initialized with getter functions to access the latest state from the model and viewmodel
     * without creating circular dependencies.
     */
    const renderer = new CanvasRenderer(
        canvas, 
        () => model.image, 
        () => model.boxes, 
        () => ({ 
            scale: model.scale, 
            panX: model.panX, 
            panY: model.panY,
            selectedBoxIds: model.selectedBoxIds,
            hoveredBoxId: window.annotationApp ? window.annotationApp.hoveredBoxId : null,
            selectionRect: model.selectionRect,
            drawingRect: window.annotationApp ? window.annotationApp.drawingRect : null,
            tooltip: window.annotationApp ? window.annotationApp.tooltip : null,
            globalColor: model.globalColor,
            globalOpacity: model.globalOpacity,
            globalFontSize: model.globalFontSize,
            currentPath: window.annotationApp ? window.annotationApp.currentPath : [],
            previewPoint: window.annotationApp ? window.annotationApp.previewPoint : null,
        })
    );
    
    /**
     * @type {AnnotationViewModel}
     * @description The instance of the ViewModel, which contains the application logic.
     */
    const viewModel = new AnnotationViewModel(model, view, renderer);

    /**
     * @global
     * @name annotationApp
     * @type {AnnotationViewModel}
     * @description A global reference to the ViewModel instance, allowing access from event handlers
     * and other parts of the application (like the view for creating text inputs).
     */
    window.annotationApp = viewModel;
    
    // Initial draw call to render the empty state.
    renderer.draw(); 
});
