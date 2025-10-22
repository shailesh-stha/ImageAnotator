// js/app.js

// Import all modules
import { AnnotationModel } from './model.js';
import { AnnotationView } from './view.js';
import { AnnotationViewModel } from './viewmodel.js';
import { CanvasRenderer } from './canvas-renderer.js';

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById("canvas");
    const model = new AnnotationModel();
    const view = new AnnotationView(canvas); 

    const renderer = new CanvasRenderer(
        canvas, 
        () => model.image, 
        () => model.boxes, 
        () => ({ 
            scale: model.scale, 
            panX: model.panX, 
            panY: model.panY,
            selectedBoxId: model.selectedBoxId, 
            hoveredBoxId: window.annotationApp ? window.annotationApp.hoveredBoxId : null,
            selectionRect: model.selectionRect,
            drawingRect: window.annotationApp ? window.annotationApp.drawingRect : null,
            tooltip: window.annotationApp ? window.annotationApp.tooltip : null,
            globalColor: model.globalColor,
            globalOpacity: model.globalOpacity,
            globalFontSize: model.globalFontSize, // <-- FIX: Added this line
            // Pass pen tool state to renderer
            currentPath: window.annotationApp ? window.annotationApp.currentPath : [],
            previewPoint: window.annotationApp ? window.annotationApp.previewPoint : null,
        })
    );
    
    const viewModel = new AnnotationViewModel(model, view, renderer);
    window.annotationApp = viewModel;
    
    renderer.draw(); 
});
// <-- FIX: Removed the extra '}' from here