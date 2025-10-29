// js/viewmodel.js

// Import required utilities/constants from model
import { MIN_SCALE, MAX_SCALE, DEFAULT_COLOR, DEFAULT_FONT_SIZE, DEFAULT_OPACITY } from './model.js';

export class AnnotationViewModel {
    constructor(model, view, renderer) {
        this.model = model;
        this.view = view;
        this.renderer = renderer;

        // --- Interaction States ---
        this.isDrawing = false;
        this.isDragging = false;
        this.isResizing = false;
        this.isRotating = false;
        this.isPanning = false;
        this.isDrawingSelection = false;
        this.isDrawingMode = false;
        this.isPenMode = false;
        this.isTextMode = false;
        this.isCanvasFocused = false; // <-- FIX: Track canvas focus for shortcuts

        this.hoveredBoxId = null;
        this.resizeHandle = null;
        this.drawingRect = null;

        // --- Pen Tool State ---
        this.currentPath = [];
        this.previewPoint = null;

        // --- Mouse/Pan Tracking ---
        this.startX = 0;
        this.startY = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.panStartX = 0;
        this.panStartY = 0;

        // --- Keyboard State ---
        this.keys = {};

        this.currentAspectRatio = "1:1";

        this.view.bindEventListeners(this.getEventHandlers());
        this.updateUI(); // Initial UI update
        // Call resize after a tick to ensure layout is complete
        setTimeout(() => this.onWindowResize(), 0);
    }

    // --- UI Update & Synchronization ---

    updateUI() {
        this.renderer.draw(); // Draw first to reflect model state

        this.view.updateImageStatus(!!this.model.image);
        this.view.updateUndoRedoButtons(
            this.model.history.length > 1,
            this.model.redoStack.length > 0
        );
        this.view.updateDeleteButton(this.model.selectedBoxIds.length > 0);

        this.view.updateGlobalStyleControls({
            color: this.model.globalColor,
            fontSize: this.model.globalFontSize,
            opacity: this.model.globalOpacity
        });

        this.view.updateToolHighlights(this.isDrawingMode ? 'bbox' : this.isPenMode ? 'pen' : this.isTextMode ? 'text' : null);

        this.view.updateAnnotationList(this.model.boxes, this.model.selectedBoxIds, {
            onAnnotationListClick: this.handleAnnotationListClick.bind(this),
            onAnnotationListHover: this.handleAnnotationListHover.bind(this),
            onAnnotationListLeave: this.handleAnnotationListLeave.bind(this),
            onCopyAnnotation: this.handleCopyAnnotation.bind(this),
            // <-- FIX: Pass correct handler for edit button click -->
            onEditAnnotation: this.handleEditAnnotationText.bind(this),
            onDeleteAnnotation: this.deleteSelectedBoxes.bind(this)
        });

        if (this.model.image) {
            this.view.updateZoomDisplay(this.model.scale);
        }
    }

    // --- Core Action Methods ---

    selectBox(id, multiSelect = false) {
        // <-- FIX: If editing text, finish that first -->
        if (this.view.isEditingText) {
            const input = document.getElementById('annotation-text-input');
            if (input) input.blur(); // Trigger save/cleanup
        }
        if (multiSelect) {
            const index = this.model.selectedBoxIds.indexOf(id);
            if (index > -1) {
                this.model.selectedBoxIds.splice(index, 1);
            } else {
                this.model.selectedBoxIds.push(id);
            }
        } else {
            this.model.selectedBoxIds = [id];
        }
        this.updateUI();
    }

    deselectAll(redraw = true) {
        if (this.view.isEditingText) {
            const input = document.getElementById('annotation-text-input');
            if (input) input.blur();
        }
        this.model.selectedBoxIds = [];
        if (redraw) this.updateUI();
    }

    deleteSelectedBoxes() {
        if (this.view.isEditingText) return; // Don't delete while editing text
        if (this.model.selectedBoxIds.length === 0) return;
        this.model.selectedBoxIds.forEach(id => this.model.deleteBox(id));
        this.deselectAll(false);
        this.model.saveState();
        this.updateUI();
        this.view.showToast("Annotation(s) deleted.");
    }

    // --- Utility Methods ---

    screenToWorld(x, y) {
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        return {
            x: (x - rect.left - this.model.panX) / this.model.scale,
            y: (y - rect.top - this.model.panY) / this.model.scale,
        };
    }

    worldToScreen(x, y) {
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        return {
            x: rect.left + (x * this.model.scale) + this.model.panX,
            y: rect.top + (y * this.model.scale) + this.model.panY,
        };
    }

    getResizeCursor(handle, angleRad) {
        const baseAngles = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
        const angleDeg = angleRad * (180 / Math.PI);
        const effectiveAngle = (baseAngles[handle] + angleDeg + 360) % 360;

        if ((effectiveAngle >= 337.5) || (effectiveAngle < 22.5)) return 'ns-resize';
        if ((effectiveAngle >= 22.5) && (effectiveAngle < 67.5)) return 'nesw-resize';
        if ((effectiveAngle >= 67.5) && (effectiveAngle < 112.5)) return 'ew-resize';
        if ((effectiveAngle >= 112.5) && (effectiveAngle < 157.5)) return 'nwse-resize';
        if ((effectiveAngle >= 157.5) && (effectiveAngle < 202.5)) return 'ns-resize';
        if ((effectiveAngle >= 202.5) && (effectiveAngle < 247.5)) return 'nesw-resize';
        if ((effectiveAngle >= 247.5) && (effectiveAngle < 292.5)) return 'ew-resize';
        if ((effectiveAngle >= 292.5) && (effectiveAngle < 337.5)) return 'nwse-resize';
        return 'default';
    }

    updateCursor(screenX, screenY) {
        this.view.tooltip = null; // Clear tooltip first
        const { canvas } = this.view.DOMElements;
        
        // Don't change cursor if editing text input
        if (this.view.isEditingText) {
             // Keep default cursor unless explicitly panning
             canvas.style.cursor = this.keys["Space"] ? "grab" : "default";
             this.renderer.draw(); // Redraw needed to clear potential tooltip
             return;
        }
        
        // Panning cursor takes priority
        if (this.keys["Space"]) {
            canvas.style.cursor = "grab";
            this.renderer.draw();
            return;
        }

        // Drawing modes have crosshair cursor
        if (this.isDrawingMode || this.isPenMode || this.isTextMode || this.isDrawingSelection) {
            canvas.style.cursor = "crosshair";
            this.renderer.draw(); // Redraw needed to clear potential tooltip
            return;
        }

        const worldPos = this.screenToWorld(screenX, screenY);
        const mouseX = worldPos.x;
        const mouseY = worldPos.y;
        const selectedBox = this.model.boxes.find((b) => b.id === this.model.selectedBoxId);
        const scale = this.model.scale;
        let newCursor = "default"; // Default cursor

        // Check handles if a box is selected
        if (selectedBox) {
            const handles = this.renderer.getHandles(selectedBox, scale);
            const handleRadius = 8 / scale; // Radius for checking handle clicks
            const rotationRadius = 10 / scale;

            if (this.renderer.isPointInCircle(mouseX, mouseY, handles.rotation.x, handles.rotation.y, rotationRadius)) {
                 newCursor = "crosshair"; // Use crosshair for rotation
                 this.view.tooltip = { text: "Rotate", x: screenX - canvas.getBoundingClientRect().left + 15, y: screenY - canvas.getBoundingClientRect().top };
            } else if (selectedBox.isTextOnly !== true) { // Only check resize handles if not text-only
                 for (const handle in handles) {
                     if (handle === "rotation") continue;
                     const pos = handles[handle];
                     if (this.renderer.isPointInCircle(mouseX, mouseY, pos.x, pos.y, handleRadius)) {
                         newCursor = this.getResizeCursor(handle, selectedBox.angle);
                         this.view.tooltip = { text: "Resize", x: screenX - canvas.getBoundingClientRect().left + 15, y: screenY - canvas.getBoundingClientRect().top };
                         break; // Found a handle, stop checking
                     }
                 }
            }
        }

        // If cursor hasn't been set by a handle, check if hovering over any box for move cursor
        if (newCursor === "default") {
            // Iterate backwards to check topmost box first
            for (let i = this.model.boxes.length - 1; i >= 0; i--) {
                const box = this.model.boxes[i];
                if (box.visible !== false && this.renderer.isPointInBox(mouseX, mouseY, box)) {
                    newCursor = "move";
                    break; // Found a box, stop checking
                }
            }
        }

        // Apply the determined cursor style
        if (canvas.style.cursor !== newCursor) {
            canvas.style.cursor = newCursor;
        }
        
        // Redraw needed if tooltip changed state
        this.renderer.draw();
    }

    /**
     * Generates a structured prompt (placeholder).
     * This method was missing, causing the "Copy" button to fail.
     * @returns {string} A placeholder string.
     */
    generateStructuredPrompt() {
        console.warn("generateStructuredPrompt() is not fully implemented. Using placeholder text.");
        
        if (!this.model.image) return "No image loaded.";

        const { boxes, selectionRect } = this.model;
        
        let prompt = "Analyze the image";
        if (selectionRect) {
            prompt += " within the selection";
        }
        prompt += ".";
        
        if (boxes.length > 0) {
            prompt += `\nThere are ${boxes.length} annotations:\n`;
            boxes.forEach((box, index) => {
                prompt += `${index + 1}. A ${box.type} annotation`;
                if (box.text && box.text !== "Not defined") {
                    prompt += ` labeled: "${box.text}"`;
                }
                prompt += ".\n";
            });
        }

        return prompt;
    }

    // --- Event Handler Collection ---

    getEventHandlers() {
        return {
            onToggleTools: this.handleToggleTools.bind(this),
            onToggleProperties: this.handleToggleProperties.bind(this),

            onUploadClick: () => this.view.DOMElements.imageLoader.click(),
            onShowUnloadConfirm: this.handleShowUnloadConfirm.bind(this),
            onConfirmUnload: this.handleConfirmUnload.bind(this),
            onCancelUnload: this.handleCancelUnload.bind(this),
            onImageLoad: this.handleImageLoad.bind(this),
            onOpenExportModal: this.view.openExportModal.bind(this.view),
            onCloseExportModal: this.view.closeExportModal.bind(this.view),
            onCopyImageAndPrompt: this.handleCopyImageAndPrompt.bind(this),
            onSaveImageToFile: this.handleSaveImageToFile.bind(this),
            onImportAnnotations: this.handleImportAnnotations.bind(this),
            onSaveJson: this.handleExportAnnotations.bind(this),

            onAddBox: () => this.handleToggleDrawingMode(),
            onPenToolClick: () => this.handleTogglePenMode(),
            onAddText: () => this.handleToggleTextMode(),
            onDeleteSelected: this.deleteSelectedBoxes.bind(this),
            onUndoClick: this.handleUndo.bind(this),
            onRedoClick: this.handleRedo.bind(this),
            onResetView: this.handleResetView.bind(this),
            onResetStyles: this.handleResetStyles.bind(this),
            onToggleSelectionDrawing: () => this.handleToggleSelectionDrawing(), // Pass no args to toggle
            onAspectRatioChange: this.handleAspectRatioChange.bind(this),

            onStyleChange: this.handleStyleChange.bind(this),

            onFontSizeDown: () => this.handleFontSizeChange(-1, true),
            onFontSizeUp: () => this.handleFontSizeChange(1, true),
            onFontSizeInput: (e) => this.handleFontSizeChange(e.target.value, false),
            onOpacityDown: () => this.handleOpacityChange(-1, true),
            onOpacityUp: () => this.handleOpacityChange(1, true),
            onOpacityInput: (e) => this.handleOpacityChange(e.target.value, false),

            onCanvasMouseDown: this.handleMouseDown.bind(this),
            onCanvasMouseMove: this.handleMouseMove.bind(this),
            onCanvasMouseUp: this.handleMouseUp.bind(this),
            onCanvasDoubleClick: this.handleDoubleClick.bind(this), // Keep for editing text
            onCanvasWheel: this.handleWheel.bind(this),
            onCanvasDrop: this.handleCanvasDrop.bind(this),
            onKeyDown: this.handleKeyDown.bind(this),
            onKeyUp: this.handleKeyUp.bind(this),
            onWindowResize: this.onWindowResize.bind(this),

            onZoomIn: this.handleZoomIn.bind(this),
            onZoomOut: this.handleZoomOut.bind(this),
            onFitToScreen: this.handleFitToScreen.bind(this),

            // <-- FIX: Add canvas focus/blur handlers -->
            onCanvasFocus: () => { this.isCanvasFocused = true; },
            onCanvasBlur: () => { this.isCanvasFocused = false; },

             // <-- FIX: Add handler for edit button click -->
             onEditAnnotation: this.handleEditAnnotationText.bind(this),
            onCloseHelpModal: this.view.hideHelpModal.bind(this.view),
        };
    }

    // --- Detailed Handler Implementations ---

    handleToggleTools() {
        const { toolsPanel, toolsToggleBtn } = this.view.DOMElements;
        toolsPanel.classList.toggle("collapsed");
        toolsToggleBtn.classList.toggle("collapsed");
        setTimeout(() => this.onWindowResize(), 50);
    }

    handleToggleProperties() {
        const { propertiesPanel, propertiesToggleBtn } = this.view.DOMElements;
        propertiesPanel.classList.toggle("collapsed");
        propertiesToggleBtn.classList.toggle("collapsed");
        setTimeout(() => this.onWindowResize(), 50);
    }

    handleImageLoad(file) {
        if (!file) return;
        this.view.showLoadingIndicator();
        const reader = new FileReader();
        reader.onload = (event) => {
            const newImage = new Image();
            newImage.onload = () => {
                this.model.resetAppState(); // Resets boxes, history, selection, view etc.
                this.model.image = newImage;
                // Reset view transform BEFORE resizing canvas
                this.model.scale = 1.0;
                this.model.panX = 0;
                this.model.panY = 0;
                this.onWindowResize(); // Adjust canvas size and potentially scale history (though history is reset)
                this.model.saveState(); // Save the initial state with the image
                this.updateUI(); // Redraw canvas, update buttons, zoom display
                this.view.hideLoadingIndicator();
                this.view.showToast("Image loaded successfully!");
            };
             newImage.onerror = () => {
                this.view.hideLoadingIndicator();
                 this.view.showToast("Error loading image file.", "error");
             };
            newImage.src = event.target.result;
        };
        reader.onerror = () => {
            this.view.hideLoadingIndicator();
            this.view.showToast("Error reading file.", "error");
        };
        reader.readAsDataURL(file);
        this.view.DOMElements.imageLoader.value = ""; // Clear file input
    }

    handleShowUnloadConfirm() {
        this.view.showUnloadConfirmModal();
    }

    handleConfirmUnload() {
        this.view.hideUnloadConfirmModal();
        this.model.resetAppState(); // Clears image, boxes, history, view etc.
        this.updateUI(); // Updates buttons, list, clears canvas via draw()
        // Ensure canvas dimensions are removed AFTER UI update clears it
        this.view.DOMElements.canvas.removeAttribute("width");
        this.view.DOMElements.canvas.removeAttribute("height");
        this.view.DOMElements.imageLoader.value = "";
        this.view.DOMElements.jsonLoader.value = "";
         // Focus body or canvas container to remove focus from modal buttons
         this.view.DOMElements.canvasContainer.focus();
    }

    handleCancelUnload() {
        this.view.hideUnloadConfirmModal();
         // Focus body or canvas container
         this.view.DOMElements.canvasContainer.focus();
    }

    handleImportAnnotations(file) {
        if (!file) return;
        // Allow importing even if no image, but maybe warn? Let's allow it for now.
        // if (!this.model.image) {
        //     this.view.showToast("Load an image before importing annotations.", "error");
        //     this.view.DOMElements.jsonLoader.value = "";
        //     return;
        // }
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const fileContent = event.target.result;
                const importedData = JSON.parse(fileContent);
                let importedBoxes;

                if (Array.isArray(importedData)) { // Annotations only
                    importedBoxes = importedData;
                } else if (importedData.annotations && Array.isArray(importedData.annotations)) { // Combined format
                    importedBoxes = importedData.annotations;
                    if(importedData.imageData) this.view.showToast("Combined JSON detected. Loading annotations only.", "success");
                } else {
                    throw new Error("Invalid JSON format");
                }

                // Basic validation
                if (importedBoxes.length > 0 && typeof importedBoxes[0].x === 'undefined') {
                     throw new Error("Invalid annotation data structure.");
                }

                 // Clear current annotations and history before loading new ones
                 this.model.boxes = [];
                 this.model.history = [];
                 this.model.redoStack = [];
                 this.model.nextId = 0; // Reset ID counter
                 this.model.selectedBoxId = null;

                this.model.currentAnnotations = importedBoxes; // Use setter to recalculate nextId
                this.deselectAll(false);
                this.model.saveState(); // Save the newly imported state
                this.updateUI();
                this.view.showToast(`Imported ${importedBoxes.length} annotations.`);

            } catch (err) {
                console.error("Import Error:", err);
                this.view.showToast(`Error: ${err.message || "Could not import annotations."}`, "error");
            } finally {
                 this.view.DOMElements.jsonLoader.value = "";
            }
        };
         reader.onerror = () => {
             this.view.showToast("Error reading JSON file.", "error");
             this.view.DOMElements.jsonLoader.value = "";
         };
        reader.readAsText(file);
    }

    handleExportAnnotations() {
        if (this.model.boxes.length === 0) {
             this.view.showToast("No annotations to export.", "error");
             return;
        }
        const dataStr = JSON.stringify(this.model.boxes, null, 2);
        const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);
        const linkElement = document.createElement("a");
        linkElement.setAttribute("href", dataUri);
        linkElement.setAttribute("download", "annotations.json");
        linkElement.click();
        this.view.closeExportModal();
    }

     // --- Refactored Export Logic ---

    async handleCopyImageAndPrompt() {
         if (!this.model.image) {
             this.view.showToast("No image loaded for copy.", "error");
             return;
         }
         if (!navigator.clipboard || !navigator.clipboard.write) {
             this.view.showToast("Clipboard API not supported by your browser.", "error");
             return;
         }

         // Get raw data directly from the model
         const { image, boxes, selectionRect } = this.model;

         // createHighResCanvas now handles all scaling and cropping
         const highResCanvas = this.renderer.createHighResCanvas(image, boxes, selectionRect);
         
         // This method is now defined, so this call will succeed
         const promptText = this.generateStructuredPrompt(); 

         try {
             const blob = await new Promise((resolve) =>
                 highResCanvas.toBlob(resolve, "image/png")
             );
             await navigator.clipboard.write([
                 new ClipboardItem({
                     "image/png": blob,
                     "text/plain": new Blob([promptText], { type: "text/plain" }),
                 }),
             ]);
             this.view.showToast("Image and prompt copied to clipboard!");
         } catch (err) {
             console.error("Copy Error:", err);
             this.view.showToast("Could not copy to clipboard. Check permissions.", "error");
         } finally {
             this.view.closeExportModal();
         }
    }

    handleSaveImageToFile() {
        if (!this.model.image) {
            this.view.showToast("No image loaded for save.", "error");
            return;
        }
        
        // Get raw data directly from the model
        const { image, boxes, selectionRect } = this.model;

        // createHighResCanvas handles all scaling and cropping
        // It takes the raw world-coordinate boxes and selectionRect
        const highResCanvas = this.renderer.createHighResCanvas(image, boxes, selectionRect);
        
        const link = document.createElement("a");
        link.download = "annotated-image.png";
        link.href = highResCanvas.toDataURL("image/png");
        link.click();
        this.view.showToast("Image download started.");
        this.view.closeExportModal();
    }


    handleUndo() {
        if (this.model.undo()) {
            this.deselectAll(false);
            this.updateUI();
            this.view.showToast("Undo successful.");
        }
    }

    handleRedo() {
        if (this.model.redo()) {
            this.deselectAll(false);
            this.updateUI();
            this.view.showToast("Redo successful.");
        }
    }

    handleResetView() {
        this.model.scale = 1.0;
        this.model.panX = 0;
        this.model.panY = 0;
        this.updateUI(); // Calls draw and updateZoomDisplay
        this.view.showToast("View reset");
    }

    handleStyleChange(property, value) {
        if (property === 'color') {
            this.model.globalColor = value;
        } else if (property === 'fontSize') {
            // Ensure value is within bounds when coming from slider
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue)) {
                 this.model.globalFontSize = Math.max(8, Math.min(48, numValue));
            }
        } else if (property === 'opacity') {
             // Ensure value is within bounds when coming from slider
             const numValue = parseFloat(value);
             if (!isNaN(numValue)) {
                 this.model.globalOpacity = Math.max(0, Math.min(1, numValue));
             }
        }
        this.updateUI();
    }

    handleFontSizeChange(value, isRelative) {
        let newValue;
        const currentSize = this.model.globalFontSize;
        if (isRelative) {
            newValue = currentSize + value;
        } else {
            newValue = parseInt(value, 10);
        }
        // Clamp the value
        newValue = Math.max(8, Math.min(48, newValue));
        if (!isNaN(newValue)) {
            this.model.globalFontSize = newValue;
        }
        this.updateUI();
    }

    handleOpacityChange(value, isRelative) {
        let newPercent;
        const currentPercent = Math.round(this.model.globalOpacity * 100);
        if (isRelative) {
            newPercent = currentPercent + value;
        } else {
            newPercent = parseInt(value, 10);
        }
        // Clamp the value
        newPercent = Math.max(0, Math.min(100, newPercent));
        if (!isNaN(newPercent)) {
            this.model.globalOpacity = newPercent / 100;
        }
        this.updateUI();
    }

    handleResetStyles() {
        this.model.resetGlobalStyles();
        this.updateUI();
        this.view.showToast("Styles reset to default");
    }

    handleToggleDrawingMode(forceOff = false) {
        if (!this.model.image && !forceOff) return; // Prevent enabling if no image
        const shouldBeOn = !this.isDrawingMode && !forceOff;

        if (shouldBeOn) {
            this.isDrawingMode = true;
            this.handleTogglePenMode(true);
            this.handleToggleTextMode(true);
            this.handleToggleSelectionDrawing(true);
        } else {
            this.isDrawingMode = false;
        }

        const { addBoxBtn } = this.view.DOMElements;
        addBoxBtn.classList.toggle("btn-primary", this.isDrawingMode);
        addBoxBtn.classList.toggle("btn-secondary", !this.isDrawingMode);
        this.updateCursorStyle();
    }

    handleTogglePenMode(forceOff = false) {
        if (!this.model.image && !forceOff) return;
        const shouldBeOn = !this.isPenMode && !forceOff;

        if (shouldBeOn) {
            this.isPenMode = true;
            this.handleToggleDrawingMode(true);
            this.handleToggleTextMode(true);
            this.handleToggleSelectionDrawing(true);
        } else {
            this.isPenMode = false;
            this.currentPath = [];
            this.previewPoint = null;
        }

        const { penToolBtn } = this.view.DOMElements;
        penToolBtn.classList.toggle("btn-primary", this.isPenMode);
        penToolBtn.classList.toggle("btn-secondary", !this.isPenMode);
        this.updateCursorStyle();
        if (!shouldBeOn) this.updateUI(); // Redraw needed to clear path preview
    }

    handleToggleTextMode(forceOff = false) {
        if (!this.model.image && !forceOff) return;
        const shouldBeOn = !this.isTextMode && !forceOff;

        if (shouldBeOn) {
            this.isTextMode = true;
            this.handleToggleDrawingMode(true);
            this.handleTogglePenMode(true);
            this.handleToggleSelectionDrawing(true);
        } else {
            this.isTextMode = false;
        }

        const { addTextBtn } = this.view.DOMElements;
        addTextBtn.classList.toggle("btn-primary", this.isTextMode);
        addTextBtn.classList.toggle("btn-secondary", !this.isTextMode);
        this.updateCursorStyle();
    }

    handleToggleSelectionDrawing(forceOff = false) {
        // Allow turning off even if no image (e.g., if it got stuck on)
        if (!this.model.image && !forceOff) return;

        const shouldBeOn = !this.isDrawingSelection && !forceOff;

        if (shouldBeOn) {
            this.isDrawingSelection = true;
            this.model.selectionRect = null;
            this.deselectAll(false);
            this.handleToggleDrawingMode(true);
            this.handleTogglePenMode(true);
            this.handleToggleTextMode(true);
            this.view.DOMElements.drawSelectionBtn.classList.replace("btn-secondary", "btn-primary");
            this.view.DOMElements.drawSelectionBtn.querySelector("span").textContent = "Cancel Drawing";
        } else {
            this.isDrawingSelection = false;
            // Only clear rect if turning off explicitly, not forcing off
            if (!forceOff) this.model.selectionRect = null;
            this.view.DOMElements.drawSelectionBtn.classList.replace("btn-primary", "btn-secondary");
            this.view.DOMElements.drawSelectionBtn.querySelector("span").textContent = "Draw Selection";
        }
        this.updateCursorStyle();
        this.updateUI();
    }


    updateCursorStyle() {
        const { canvas } = this.view.DOMElements;
         if (this.isDrawingMode || this.isPenMode || this.isTextMode || this.isDrawingSelection) {
             canvas.style.cursor = "crosshair";
         } else if (this.keys["Space"]) {
             canvas.style.cursor = "grab";
         } else {
             canvas.style.cursor = "default";
             // Force redraw to potentially clear tooltips if mode changed
             this.renderer.draw();
             // updateCursor will be called on next mouse move to show move/resize
         }
    }


    handleAspectRatioChange(ratio) {
        this.currentAspectRatio = ratio;
        this.model.selectionRect = null;
        // If selection drawing was active, turn it off and back on to reset visually
        if (this.isDrawingSelection) {
            this.handleToggleSelectionDrawing(true); // Force off
            this.handleToggleSelectionDrawing(false); // Force on
        } else {
            this.updateUI(); // Just redraw if not actively drawing
        }
    }

    handleAnnotationListClick(id, multiSelect) {
        this.selectBox(id, multiSelect);
    }

    handleAnnotationListHover(id) {
        this.hoveredBoxId = id;
        this.view.updateAnnotationHighlight(id, true);
        this.renderer.draw();
    }

    handleAnnotationListLeave() {
        this.view.updateAnnotationHighlight(this.hoveredBoxId, false);
    handleAnnotationListLeave() {
        this.view.updateAnnotationHighlight(this.hoveredBoxId, false);
        this.hoveredBoxId = null;
        this.renderer.draw();
    }

    handleCopyAnnotation() {
        if (this.model.selectedBoxIds.length > 0) {
            this.copiedAnnotations = this.model.selectedBoxIds.map(id => this.model.boxes.find(b => b.id === id));
            this.view.showToast("Annotation(s) copied.");
        }
    }

    handlePasteAnnotation() {
        if (this.copiedAnnotations) {
            this.copiedAnnotations.forEach(box => {
                const newBox = this.model.copyBox(box.id);
                if (newBox) {
                    this.model.saveState();
                    this.selectBox(newBox.id);
                }
            });
            this.view.showToast("Annotation(s) pasted.");
        }
    }

    handleSelectAll() {
        this.model.selectedBoxIds = this.model.boxes.map(b => b.id);
        this.updateUI();
    }

    handleFitToScreen() {
        if (!this.model.image) return;
        const { canvas } = this.view.DOMElements;
        const { naturalWidth, naturalHeight } = this.model.image;
        const { width, height } = canvas;
        const scaleX = width / naturalWidth;
        const scaleY = height / naturalHeight;
        this.model.scale = Math.min(scaleX, scaleY);
        this.model.panX = (width - naturalWidth * this.model.scale) / 2;
        this.model.panY = (height - naturalHeight * this.model.scale) / 2;
        this.updateUI();
    }

     // <-- FIX: Renamed handler for clarity -->
     handleEditAnnotationText(event, boxId) {
        // Called by edit button in list OR double click
        if (this.view.isEditingText) return; // Don't allow multiple edits

         const box = this.model.boxes.find(b => b.id === boxId);
         if (box) {
             // Ensure the box is selected visually when editing from list
             if (this.model.selectedBoxId !== boxId) {
                 this.selectBox(boxId);
             }
            this.view.createTextInput(box, (value) => {
                 const currentBox = this.model.boxes.find(b => b.id === box.id);
                 if (currentBox) {
                     const trimmedValue = value.trim();
                     // Only save if text actually changed to avoid unnecessary history states
                     if (currentBox.text !== trimmedValue && !(currentBox.text === "Not defined" && trimmedValue === "")) {
                         currentBox.text = trimmedValue ? trimmedValue : "Not defined";
                         this.model.saveState();
                     }
                     this.updateUI(); // Update list display
                 }
             });
         }
     }


    handleKeyDown(e) {
        this.keys[e.code] = true;

        // Panning start
        if (e.code === 'Space' && !this.isPanning) {
             // Check if focus is on an input where space is needed
             const activeEl = document.activeElement;
             const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
             if (!isTyping) {
                 e.preventDefault(); // Prevent page scrolling
                 this.updateCursorStyle();
             }
        }

        // Handle modal escapes first
        if (e.key === 'Escape') {
             if (!this.view.DOMElements.unloadConfirmModal.classList.contains('hidden')) {
                this.handleCancelUnload(); return;
             }
             if (!this.view.DOMElements.exportModal.classList.contains('hidden')) {
                 this.view.closeExportModal(); return;
             }
        }

        // Ignore shortcuts if editing text input on canvas OR focus is in a sidebar input
        const activeEl = document.activeElement;
        const isTypingInInput = activeEl && (activeEl.tagName === 'INPUT' && (activeEl.type === 'text' || activeEl.type === 'color' || activeEl.type === 'range') || activeEl.tagName === 'SELECT');

        if (this.view.isEditingText || isTypingInInput) {
             // Allow Enter/Escape in text input handled by its own listener
             return;
        }

        // Shortcuts requiring canvas focus (delete, arrows, tool toggles)
        if (this.isCanvasFocused) {
            if (this.model.image) { // Tool toggles only if image loaded
                if (e.code === 'KeyB') { e.preventDefault(); this.handleToggleDrawingMode(); }
                if (e.code === 'KeyP') { e.preventDefault(); this.handleTogglePenMode(); }
                if (e.code === 'KeyT') { e.preventDefault(); this.handleToggleTextMode(); }
            }

             // Cancel drawing modes with Escape
             if (e.key === 'Escape') {
                 if (this.isPenMode) { this.handleTogglePenMode(); return; }
                 if (this.isDrawingSelection) { this.handleToggleSelectionDrawing(); return; }
                 if (this.isDrawing) { // Handles bbox/text drawing in progress
                     this.isDrawing = false;
                     this.drawingRect = null;
                     if(this.isDrawingMode) this.handleToggleDrawingMode();
                     if(this.isTextMode) this.handleToggleTextMode();
                     this.updateUI();
                     return;
                 }
             }

            // Box manipulation
            if (this.model.selectedBoxIds.length > 0) {
                if (e.code === "Delete" || e.code === "Backspace") { e.preventDefault(); this.deleteSelectedBoxes(); }
                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
                    e.preventDefault(); // Prevent page scrolling
                    this.model.selectedBoxIds.forEach(id => {
                        const box = this.model.boxes.find((b) => b.id === id);
                        if (!box) return;
                        const amount = (this.keys["Shift"] ? 10 : 1) / this.model.scale; // Nudge amount
                        let dx = 0, dy = 0;
                        if (e.code === "ArrowUp") dy = -amount;
                        if (e.code === "ArrowDown") dy = amount;
                        if (e.code === "ArrowLeft") dx = -amount;
                        if (e.code === "ArrowRight") dx = amount;

                        box.x += dx; box.y += dy;
                        if (box.type === 'poly') {
                            box.points = box.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                        }
                    });
                    this.renderer.draw(); // Immediate feedback
                }
            }
        }
                    let dx = 0, dy = 0;
                    if (e.code === "ArrowUp") dy = -amount;
                    if (e.code === "ArrowDown") dy = amount;
                    if (e.code === "ArrowLeft") dx = -amount;
                    if (e.code === "ArrowRight") dx = amount;

                    box.x += dx; box.y += dy;
                    if (box.type === 'poly') {
                        box.points = box.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                    }
                    this.renderer.draw(); // Immediate feedback
                }
            }
        }

        // Global shortcuts (Undo/Redo, Clear Selection) - Don't require canvas focus
        if (e.key === '?') {
            e.preventDefault();
            this.view.showHelpModal();
        }
        if (e.ctrlKey || e.metaKey) {
            if (e.code === "KeyC") { e.preventDefault(); this.handleCopyAnnotation(); }
            if (e.code === "KeyV") { e.preventDefault(); this.handlePasteAnnotation(); }
            if (e.code === "KeyA") { e.preventDefault(); this.handleSelectAll(); }
            if (e.code === "KeyZ") { e.preventDefault(); this.handleUndo(); }
            if (e.code === "KeyY") { e.preventDefault(); this.handleRedo(); }
            if (e.code === "KeyD" && this.model.selectionRect) {
                 e.preventDefault();
                 this.model.selectionRect = null;
                 this.handleToggleSelectionDrawing(true); // Also turn off selection mode
                 this.updateUI();
                 this.view.showToast("Selection cleared");
            }
        }

        if (e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0') {
            e.preventDefault();
            if (e.code === 'Equal') this.handleZoomIn();
            if (e.code === 'Minus') this.handleZoomOut();
            if (e.code === 'Digit0') this.handleResetView();
        }

        if (e.code === 'KeyF') {
            e.preventDefault();
            this.handleFitToScreen();
        }
    }

    handleKeyUp(e) {
        this.keys[e.code] = false;

        // Stop panning
        if (e.code === 'Space') {
            const activeEl = document.activeElement;
             const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
             if (!isTyping) {
                 e.preventDefault();
             }
            // Update cursor based on current mode if panning stopped
            if(this.isPanning) this.isPanning = false; // Ensure panning state is off
            this.updateCursorStyle(); // Re-evaluate cursor
        }

        // Ignore if editing text or focus is in sidebar input
        const activeEl = document.activeElement;
        const isTypingInInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT');
         if (this.view.isEditingText || isTypingInInput) {
             return;
        }

        // Save state after finishing arrow key nudge (only if canvas has focus)
        if (this.isCanvasFocused && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && this.model.selectedBoxIds.length > 0) {
            this.model.saveState();
        }

        // Update cursor based on mouse position if relevant keys released
        if (e.code !== 'Space') { // Avoid redundant updateCursor if space was just handled
            this.updateCursor(e.clientX, e.clientY);
        }
    }


    handleMouseDown(e) {
        // Give canvas focus when clicked
        this.view.DOMElements.canvas.focus();

        if (!this.model.image) { this.view.DOMElements.imageLoader.click(); return; }

        if (this.keys["Space"] || e.button === 1) { // Middle mouse or Spacebar
            e.preventDefault();
            this.isPanning = true;
            this.panStartX = e.clientX - this.model.panX;
            this.panStartY = e.clientY - this.model.panY;
            this.view.DOMElements.canvas.style.cursor = 'grabbing'; // Instant feedback
            // this.view.updateCanvasDrawingMode(true); // Already sets grabbing
            return;
        }
        if (e.button !== 0 || this.view.isEditingText) return; // Only left clicks, ignore if editing text

        const mousePos = this.screenToWorld(e.clientX, e.clientY);
        this.startX = mousePos.x;
        this.startY = mousePos.y;

        // --- Pen Tool Logic ---
        if (this.isPenMode) {
            if (this.currentPath.length > 2) {
                const firstPoint = this.currentPath[0];
                const dist = Math.hypot(this.startX - firstPoint.x, this.startY - firstPoint.y);
                if (dist < 8 / this.model.scale) { // Increased tolerance for closing
                    const newPoly = this.model.addPolygon(this.currentPath);
                    this.model.saveState();
                    this.handleTogglePenMode(); // Turn off pen mode
                    this.selectBox(newPoly.id); // Select the new polygon
                    this.handleEditAnnotationText(null, newPoly.id); // Immediately trigger text edit
                    return;
                }
            }
            this.currentPath.push({ x: this.startX, y: this.startY });
            this.previewPoint = null;
            this.updateUI();
            return;
        }

        // --- Check Handles (Rotation, Resize) ---
        if (this.model.selectedBoxIds.length === 1) {
            const selectedBox = this.model.boxes.find((b) => b.id === this.model.selectedBoxIds[0]);
            const handles = this.renderer.getHandles(selectedBox, this.model.scale);
            const handleRadius = 8 / this.model.scale;
            const rotationRadius = 10 / this.model.scale;

            if (this.renderer.isPointInCircle(this.startX, this.startY, handles.rotation.x, handles.rotation.y, rotationRadius)) {
                this.isRotating = true; return;
            }

            // Only check resize handles if not text-only
            if (selectedBox.isTextOnly !== true) {
                 for (const handle in handles) {
                     if (handle === "rotation") continue;
                     const pos = handles[handle];
                     if (this.renderer.isPointInCircle(this.startX, this.startY, pos.x, pos.y, handleRadius)) {
                         this.isResizing = true;
                         this.resizeHandle = handle;
                         const oppositeHandleMap = { nw: "se", ne: "sw", sw: "ne", se: "nw", n: "s", s: "n", w: "e", e: "w" };
                         const oppositeHandle = oppositeHandleMap[handle];
                         this.offsetX = handles[oppositeHandle].x;
                         this.offsetY = handles[oppositeHandle].y;
                         return;
                     }
                 }
            }
        }

        // --- Check Dragging ---
        for (let i = this.model.boxes.length - 1; i >= 0; i--) {
            const box = this.model.boxes[i];
            if (box.visible !== false && this.renderer.isPointInBox(this.startX, this.startY, box)) {
                if (!this.model.selectedBoxIds.includes(box.id)) {
                    this.selectBox(box.id, e.ctrlKey || e.metaKey);
                }
                this.isDragging = true;
                this.offsetX = this.startX - box.x;
                this.offsetY = this.startY - box.y;
                // No redraw here, happens on mousemove
                return;
            }
        }

        // --- Start Drawing (Bbox, Text Box, Selection) ---
        // Deselect only if we didn't start dragging/resizing/rotating
        if (!this.isDragging && !this.isResizing && !this.isRotating) {
            this.deselectAll(false);
            if (this.isDrawingMode || this.isTextMode || this.isDrawingSelection) {
                this.isDrawing = true;
            }
            this.updateUI(); // Redraw needed if deselected
        }
    }


    handleMouseMove(e) {
        // Optimization: check if mouse actually moved significantly
        // if (e.movementX === 0 && e.movementY === 0 && !this.isDrawing && !this.isPenMode) return; // FIX - check isDrawing

        if (!this.model.image) return;

        if (this.isPanning) {
            this.model.panX = e.clientX - this.panStartX;
            this.model.panY = e.clientY - this.panStartY;
            this.renderer.draw();
            return;
        }

        const worldPos = this.screenToWorld(e.clientX, e.clientY);
        const mouseX = worldPos.x; const mouseY = worldPos.y;

        if (this.isPenMode && this.currentPath.length > 0) {
            this.previewPoint = { x: mouseX, y: mouseY };
            this.updateUI();
            return;
        }

        if (this.isDrawing) {
            let width = mouseX - this.startX;
            let height = mouseY - this.startY;

            if (this.isDrawingSelection && this.currentAspectRatio) {
                const [ratioW, ratioH] = this.currentAspectRatio.split(":").map(Number);
                const targetRatio = ratioW / ratioH;
                if (Math.abs(width) / (Math.abs(height) || 1) > targetRatio) {
                    width = (Math.abs(height) || 1) * targetRatio * Math.sign(width);
                } else {
                    height = (Math.abs(width) || 1) / targetRatio * Math.sign(height);
                }
            } else if (!this.isDrawingSelection && this.keys["Shift"]) {
                const side = Math.max(Math.abs(width), Math.abs(height));
                width = side * Math.sign(width);
                height = side * Math.sign(height);
            }

            this.drawingRect = {
                x: width > 0 ? this.startX : this.startX + width,
                y: height > 0 ? this.startY : this.startY + height,
                w: Math.abs(width), h: Math.abs(height),
            };
            this.renderer.draw();
            return;
        }


        const boxes = this.model.boxes.filter((b) => this.model.selectedBoxIds.includes(b.id));
        
        // Only update cursor or transform if NOT drawing and a box might be involved
        if (!this.isDrawing) {
            this.updateCursor(e.clientX, e.clientY);
        }

        if (boxes.length === 0) return; // No selected box, nothing more to do


        if (this.isRotating && boxes.length === 1) {
            const box = boxes[0];
            const centerX = box.x + box.w / 2; const centerY = box.y + box.h / 2;
            const newAngle = Math.atan2(mouseY - centerY, mouseX - centerX) + Math.PI / 2;
            const angleDiff = newAngle - box.angle;

             if (box.type === 'poly') {
                box.points = box.points.map(p => {
                    const relX = p.x - centerX; const relY = p.y - centerY;
                    return {
                        x: centerX + relX * Math.cos(angleDiff) - relY * Math.sin(angleDiff),
                        y: centerY + relX * Math.sin(angleDiff) + relY * Math.cos(angleDiff)
                    };
                });
                // Bbox will be updated on mouseup
            }
            box.angle = newAngle;
            this.renderer.draw(); // Redraw during rotation

        } else if (this.isDragging) {
            const dx = mouseX - this.startX;
            const dy = mouseY - this.startY;

            boxes.forEach(box => {
                box.x += dx;
                box.y += dy;
                if (box.type === 'poly') {
                    box.points = box.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                }
            });

            this.startX = mouseX;
            this.startY = mouseY;

            this.renderer.draw(); // Redraw during drag

        } else if (this.isResizing && boxes.length === 1) {
            const box = boxes[0];
            const pivotX = this.offsetX; const pivotY = this.offsetY;
            const angle = box.angle;
            const cosA = Math.cos(angle); const sinA = Math.sin(angle);
            const dx = mouseX - pivotX; const dy = mouseY - pivotY;
            const rotatedMouseX = dx * cosA + dy * sinA;
            const rotatedMouseY = -dx * sinA + dy * cosA;
            let newWidth = box.w, newHeight = box.h;
            const minDim = 1 / this.model.scale; // Minimum dimension in world coords

            // Calculate new dimensions based on handle and rotated mouse position
            if (this.resizeHandle.includes('e')) newWidth = Math.max(minDim, rotatedMouseX);
            if (this.resizeHandle.includes('w')) newWidth = Math.max(minDim, -rotatedMouseX);
            if (this.resizeHandle.includes('s')) newHeight = Math.max(minDim, rotatedMouseY);
            if (this.resizeHandle.includes('n')) newHeight = Math.max(minDim, -rotatedMouseY);

            // Maintain aspect ratio if Shift is pressed (only for corner handles)
            if (this.keys["Shift"] && ['nw', 'ne', 'sw', 'se'].includes(this.resizeHandle)) {
                 const aspectRatio = (box.w > 0 && box.h > 0) ? box.w / box.h : 1;
                 if (newWidth / aspectRatio > newHeight) { // Width is the limiting dimension
                     newHeight = newWidth / aspectRatio;
                 } else { // Height is the limiting dimension
                     newWidth = newHeight * aspectRatio;
                 }
                 // Recalculate based on which axis changed more relative to aspect ratio? Simpler:
                  if (this.resizeHandle.includes('e') || this.resizeHandle.includes('w')) {
                      newHeight = newWidth / aspectRatio;
                  } else { // n or s
                      newWidth = newHeight * aspectRatio;
                  }
                  newWidth = Math.max(minDim, newWidth);
                  newHeight = Math.max(minDim, newHeight);

            }

            // Calculate new center relative to pivot in rotated coordinates
            let rotatedCenterX = 0, rotatedCenterY = 0;
            if (this.resizeHandle.includes('e')) rotatedCenterX = newWidth / 2;
            if (this.resizeHandle.includes('w')) rotatedCenterX = -newWidth / 2;
            if (this.resizeHandle.includes('s')) rotatedCenterY = newHeight / 2;
            if (this.resizeHandle.includes('n')) rotatedCenterY = -newHeight / 2;

            // Rotate center back and add pivot offset
            const centerX = pivotX + rotatedCenterX * cosA - rotatedCenterY * sinA;
            const centerY = pivotY + rotatedCenterX * sinA + rotatedCenterY * cosA;

            // Calculate new top-left
            const newX = centerX - (newWidth / 2 * cosA) + (newHeight / 2 * sinA);
            const newY = centerY - (newWidth / 2 * sinA) - (newHeight / 2 * cosA);

             // --- Polygon Point Scaling ---
             if (box.type === 'poly') {
                 const oldW = box.w > 0 ? box.w : 1;
                 const oldH = box.h > 0 ? box.h : 1;
                 const scaleX = newWidth / oldW;
                 const scaleY = newHeight / oldH;

                 box.points = box.points.map(p => {
                      let vecX = p.x - pivotX; let vecY = p.y - pivotY;
                      let rotatedVecX = vecX * cosA + vecY * sinA;
                      let rotatedVecY = -vecX * sinA + vecY * cosA;

                      // Apply scaling based on which handle edge is NOT fixed
                      if (!this.resizeHandle.includes('w')) rotatedVecX *= scaleX;
                      if (!this.resizeHandle.includes('e')) rotatedVecX *= scaleX;
                      if (!this.resizeHandle.includes('n')) rotatedVecY *= scaleY;
                      if (!this.resizeHandle.includes('s')) rotatedVecY *= scaleY;
                     
                       // Simpler scaling logic might be needed here, scaling relative to pivot
                       rotatedVecX *= scaleX;
                       rotatedVecY *= scaleY;


                      let finalVecX = rotatedVecX * cosA - rotatedVecY * sinA;
                      let finalVecY = rotatedVecX * sinA + rotatedVecY * cosA;
                      return { x: pivotX + finalVecX, y: pivotY + finalVecX };
                 });
                 // Bbox will be updated on mouseup
             }

            // Update box properties
            box.x = newX; box.y = newY;
            box.w = newWidth; box.h = newHeight;
            this.renderer.draw(); // Redraw during resize
        }
    }


    handleMouseUp(e) {
        if (e.button !== 0) return; // Ignore non-left clicks

        // --- Finalize Panning ---
        if (this.isPanning) {
            this.isPanning = false;
            // Cursor update happens in keyUp or next mouseMove
            this.updateCursorStyle(); // Ensure cursor resets correctly
            return;
        }

        const finalDrawingRect = this.drawingRect;
        this.drawingRect = null; // Clear drawing preview immediately

        // --- Finalize Drawing (Bbox, Text Box, Selection) ---
        if (this.isDrawing) {
            this.isDrawing = false; // Stop drawing state regardless of rect validity
             if (finalDrawingRect && finalDrawingRect.w > 5 && finalDrawingRect.h > 5) { // Min size check
                 if (this.isDrawingSelection) {
                     this.model.selectionRect = finalDrawingRect;
                     this.handleToggleSelectionDrawing(true); // Force selection mode off
                 } else { // Finished drawing a bbox or text box
                     const newBox = this.model.addBox(finalDrawingRect);
                     if (this.isTextMode) {
                         newBox.isTextOnly = true;
                     }
                     this.model.saveState(); // Save new box state
                     this.selectBox(newBox.id); // Select the new box
                     // Trigger text edit *after* saving and selecting
                     this.handleEditAnnotationText(null, newBox.id);

                     // Deactivate the tool *after* finishing the draw
                      if (this.isDrawingMode) this.handleToggleDrawingMode(true); // Force drawing mode off
                      if (this.isTextMode) this.handleToggleTextMode(true); // Force text mode off
                 }
             } else {
                 // If drawing ended without valid rect (just a click), deactivate the tool
                 if (this.isDrawingMode) this.handleToggleDrawingMode(true);
                 if (this.isTextMode) this.handleToggleTextMode(true);
                 if (this.isDrawingSelection) this.handleToggleSelectionDrawing(true);
             }
        } // End if (this.isDrawing)


        // --- Finalize Transformations (Drag, Resize, Rotate) ---
        if (this.isDragging || this.isResizing || this.isRotating) {
            this.model.selectedBoxIds.forEach(id => {
                const box = this.model.boxes.find(b => b.id === id);
                if (box && box.type === 'poly') {
                    // Update bounding box based on final point positions
                    const { x, y, w, h } = this.model.calculateBoundingBox(box.points);
                    box.x = x; box.y = y; box.w = w; box.h = h;
                }
                if (box && (this.isResizing || this.isRotating)) { // Ensure width/height are positive
                    box.w = Math.abs(box.w);
                    box.h = Math.abs(box.h);
                }
            });
            this.model.saveState(); // Save final transformed state
        }

        // --- Reset Interaction States ---
        this.isDragging = this.isResizing = this.isRotating = false;
        // isDrawing handled above, isDrawingSelection handled in its toggle
        this.resizeHandle = null;
        this.startX = this.startY = this.offsetX = this.offsetY = 0;

        this.updateUI(); // Redraw final state
        this.updateCursor(e.clientX, e.clientY); // Update cursor for potential hover state
    }

     // <-- FIX: Use handleEditAnnotationText for double click too -->
     handleDoubleClick(e) {
         if (this.view.isEditingText) return;
         const mousePos = this.screenToWorld(e.clientX, e.clientY);
         for (let i = this.model.boxes.length - 1; i >= 0; i--) {
             const box = this.model.boxes[i];
             if (box.visible !== false && this.renderer.isPointInBox(mousePos.x, mousePos.y, box)) {
                this.selectBox(box.id);
                 this.handleEditAnnotationText(e, box.id); // Call the dedicated edit handler
                 return;
             }
         }
     }


    // Centralized zoom function
    zoomCanvas(factor, centerX, centerY) {
        if (!this.model.image) return; // Prevent zooming without image

        const oldScale = this.model.scale;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor));
        
        // If scale didn't change (already at min/max), do nothing
        if (newScale === oldScale) return;

        const scaleRatio = newScale / oldScale;

        // Adjust pan to keep the point under the cursor (centerX, centerY) stationary
        this.model.panX = centerX - (centerX - this.model.panX) * scaleRatio;
        this.model.panY = centerY - (centerY - this.model.panY) * scaleRatio;
        this.model.scale = newScale;

        this.renderer.draw();
        this.view.updateZoomDisplay(this.model.scale); // Update display
    }

    handleWheel(e) {
        if (!this.model.image || this.view.isEditingText) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        this.zoomCanvas(delta, mouseX, mouseY);
    }

     handleZoomIn() {
        if (!this.model.image) return;
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        this.zoomCanvas(1.25, centerX, centerY); // Slightly larger zoom step
    }

    handleZoomOut() {
        if (!this.model.image) return;
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        this.zoomCanvas(0.8, centerX, centerY); // Slightly larger zoom step
    }


    handleCanvasDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.view.DOMElements.canvasContainer.style.backgroundColor = "";

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            if (file.type === "application/json") {
                this.handleImportAnnotations(file);
            } else if (file.type.startsWith("image/")) {
                this.handleImageLoad(file);
            } else {
                 this.view.showToast("Unsupported file type.", "error");
            }
        }
    }

    onWindowResize() {
        const { canvas, canvasContainer, unloadImageBtn, canvasControls } = this.view.DOMElements;
        const containerRect = canvasContainer.getBoundingClientRect();

        if (!this.model.image) {
             canvas.width = containerRect.width; // Clear canvas size even if no image
             canvas.height = containerRect.height;
             this.view.DOMElements.ctx.clearRect(0,0, canvas.width, canvas.height); // Explicit clear
             unloadImageBtn.classList.add('hidden');
             canvasControls.classList.add('hidden');
             canvasControls.classList.remove('flex');
             return;
         }

        const oldCanvasWidth = canvas.width;
        const oldCanvasHeight = canvas.height;
        const margin = 32;
        const availableWidth = containerRect.width - margin;
        const availableHeight = containerRect.height - margin;
        const imageAspectRatio = this.model.image.naturalWidth / this.model.image.naturalHeight;
        const containerAspectRatio = availableWidth / availableHeight;
        let newCanvasWidth, newCanvasHeight;

        if (imageAspectRatio > containerAspectRatio) {
            newCanvasWidth = availableWidth;
            newCanvasHeight = availableWidth / imageAspectRatio;
        } else {
            newCanvasHeight = availableHeight;
            newCanvasWidth = availableHeight * imageAspectRatio;
        }

        canvas.width = Math.max(1, Math.floor(newCanvasWidth));
        canvas.height = Math.max(1, Math.floor(newCanvasHeight));

        // Only scale if dimensions actually changed and were previously set
        if (oldCanvasWidth > 0 && oldCanvasHeight > 0 && (newCanvasWidth !== oldCanvasWidth || newCanvasHeight !== oldCanvasHeight)) {
            // This scaling logic on resize can be problematic if done incorrectly,
            // especially with history. A simpler approach is often to just reset
            // the view (zoom/pan) on resize. Let's try resetting the view instead.
             console.warn("Canvas resized, resetting view.");
             this.handleResetView(); // Reset zoom/pan instead of scaling objects

            // --- Commenting out scaling logic for now ---
            /*
            const scaleX = newCanvasWidth / oldCanvasWidth;
            const scaleY = newCanvasHeight / oldCanvasHeight;
            const scaleBoxArray = (boxArray) => { // ... scaling logic ... };
            scaleBoxArray(this.model.boxes);
            this.model.history = this.model.history.map(state => { // ... scaling logic ... });
            this.model.redoStack = this.model.redoStack.map(state => { // ... scaling logic ... });
            if (this.model.selectionRect) { // ... scaling logic ... }
            */
        }

        const canvasOffsetX = (containerRect.width - newCanvasWidth) / 2;
        const canvasOffsetY = (containerRect.height - newCanvasHeight) / 2;
        unloadImageBtn.style.top = `${canvasOffsetY}px`;
        unloadImageBtn.style.right = `${canvasOffsetX}px`;

        // Ensure canvas controls are visible if image exists
        if (this.model.image) {
            canvasControls.classList.remove('hidden');
            canvasControls.classList.add('flex');
        }

        this.renderer.draw(); // Redraw with new dimensions
        this.updateUI(); // Update dependent UI like zoom display
    }

} // End of AnnotationViewModel class