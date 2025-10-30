// js/viewmodel.js

// Import required utilities/constants from model
import { MIN_SCALE, MAX_SCALE, DEFAULT_COLOR, DEFAULT_FONT_SIZE, DEFAULT_OPACITY } from './model.js';

/**
 * @class AnnotationViewModel
 * @description Manages the application state and logic, acting as the intermediary
 * between the Model (data) and the View (UI). It handles user interactions,
 * updates the model, and triggers UI updates in the view.
 */
export class AnnotationViewModel {
    /**
     * @constructor
     * @param {AnnotationModel} model - The data model instance.
     * @param {AnnotationView} view - The view instance for UI manipulation.
     * @param {CanvasRenderer} renderer - The renderer for drawing on the canvas.
     */
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
        this.isCanvasFocused = false;

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

    /**
     * @description Synchronizes the entire UI with the current state of the model.
     * This is a central method called after any state change.
     */
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
            onEditAnnotation: this.handleEditAnnotationText.bind(this),
            onDeleteAnnotation: this.deleteSelectedBoxes.bind(this)
        });

        if (this.model.image) {
            this.view.updateZoomDisplay(this.model.scale);
        }
    }

    // --- Core Action Methods ---

    /**
     * @description Selects an annotation box.
     * @param {number} id - The ID of the box to select.
     * @param {boolean} [multiSelect=false] - If true, adds to the current selection.
     */
    selectBox(id, multiSelect = false) {
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

    /**
     * @description Deselects all currently selected annotation boxes.
     * @param {boolean} [redraw=true] - Whether to trigger a UI update.
     */
    deselectAll(redraw = true) {
        if (this.view.isEditingText) {
            const input = document.getElementById('annotation-text-input');
            if (input) input.blur();
        }
        this.model.selectedBoxIds = [];
        if (redraw) this.updateUI();
    }

    /**
     * @description Deletes all currently selected annotation boxes from the model.
     */
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

    /**
     * @description Converts screen coordinates (e.g., from a mouse event) to canvas world coordinates.
     * @param {number} x - The x-coordinate on the screen.
     * @param {number} y - The y-coordinate on the screen.
     * @returns {{x: number, y: number}} The corresponding coordinates in the canvas world.
     */
    screenToWorld(x, y) {
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        return {
            x: (x - rect.left - this.model.panX) / this.model.scale,
            y: (y - rect.top - this.model.panY) / this.model.scale,
        };
    }

    /**
     * @description Converts canvas world coordinates to screen coordinates.
     * @param {number} x - The x-coordinate in the canvas world.
     * @param {number} y - The y-coordinate in the canvas world.
     * @returns {{x: number, y: number}} The corresponding coordinates on the screen.
     */
    worldToScreen(x, y) {
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        return {
            x: rect.left + (x * this.model.scale) + this.model.panX,
            y: rect.top + (y * this.model.scale) + this.model.panY,
        };
    }

    /**
     * @description Determines the appropriate CSS cursor style for a resize handle based on the handle's position and the box's rotation.
     * @param {string} handle - The handle being interacted with (e.g., 'nw', 'se').
     * @param {number} angleRad - The rotation angle of the box in radians.
     * @returns {string} The CSS cursor string (e.g., 'ns-resize', 'nesw-resize').
     */
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

    /**
     * @description Updates the canvas cursor based on the mouse position and current interaction state.
     * @param {number} screenX - The mouse's X coordinate on the screen.
     * @param {number} screenY - The mouse's Y coordinate on the screen.
     */
    updateCursor(screenX, screenY) {
        this.view.tooltip = null; // Clear tooltip first
        const { canvas } = this.view.DOMElements;
        
        if (this.view.isEditingText) {
             canvas.style.cursor = this.keys["Space"] ? "grab" : "default";
             this.renderer.draw();
             return;
        }
        
        if (this.keys["Space"]) {
            canvas.style.cursor = "grab";
            this.renderer.draw();
            return;
        }

        if (this.isDrawingMode || this.isPenMode || this.isTextMode || this.isDrawingSelection) {
            canvas.style.cursor = "crosshair";
            this.renderer.draw();
            return;
        }

        const worldPos = this.screenToWorld(screenX, screenY);
        const mouseX = worldPos.x;
        const mouseY = worldPos.y;
        let selectedBox = null;
        if (this.model.selectedBoxIds.length === 1) {
            selectedBox = this.model.boxes.find((b) => b.id === this.model.selectedBoxIds[0]);
        }
        const scale = this.model.scale;
        let newCursor = "default";

        if (selectedBox) {
            const handles = this.renderer.getHandles(selectedBox, scale);
            const handleRadius = 8 / scale;
            const rotationRadius = 10 / scale;

            if (this.renderer.isPointInCircle(mouseX, mouseY, handles.rotation.x, handles.rotation.y, rotationRadius)) {
                 newCursor = "crosshair";
                 this.view.tooltip = { text: "Rotate", x: screenX - canvas.getBoundingClientRect().left + 15, y: screenY - canvas.getBoundingClientRect().top };
            } else if (selectedBox.isTextOnly !== true) {
                 for (const handle in handles) {
                     if (handle === "rotation") continue;
                     const pos = handles[handle];
                     if (this.renderer.isPointInCircle(mouseX, mouseY, pos.x, pos.y, handleRadius)) {
                         newCursor = this.getResizeCursor(handle, selectedBox.angle);
                         this.view.tooltip = { text: "Resize", x: screenX - canvas.getBoundingClientRect().left + 15, y: screenY - canvas.getBoundingClientRect().top };
                         break;
                     }
                 }
            }
        }

        if (newCursor === "default") {
            for (let i = this.model.boxes.length - 1; i >= 0; i--) {
                const box = this.model.boxes[i];
                if (box.visible !== false && this.renderer.isPointInBox(mouseX, mouseY, box)) {
                    newCursor = "move";
                    break;
                }
            }
        }

        if (canvas.style.cursor !== newCursor) {
            canvas.style.cursor = newCursor;
        }
        
        this.renderer.draw();
    }

    /**
     * @description Generates a structured text prompt based on the current annotations.
     * @returns {string} A descriptive string of the annotations.
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

    /**
     * @description Gathers and returns an object containing all event handlers for the application.
     * This centralized approach makes it easy to bind all events in the View.
     * @returns {Object.<string, Function>} An object mapping event names to handler functions.
     */
    getEventHandlers() {
        return {
            onToggleTools: this.handleToggleTools.bind(this),
            onToggleProperties: this.handleToggleProperties.bind(this),
            ...this.getFileActionHandlers(),
            ...this.getToolActionHandlers(),
            ...this.getStyleActionHandlers(),
            ...this.getCanvasEventHandlers(),
            ...this.getGlobalEventHandlers(),
            ...this.getModalEventHandlers(),
            onEditAnnotation: this.handleEditAnnotationText.bind(this),
        };
    }

    /**
     * @description Returns handlers related to file actions (load, unload, export, import).
     * @returns {Object.<string, Function>}
     */
    getFileActionHandlers() {
        return {
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
        };
    }

    /**
     * @description Returns handlers related to annotation tools (add, delete, undo, redo).
     * @returns {Object.<string, Function>}
     */
    getToolActionHandlers() {
        return {
            onAddBox: () => this.handleToggleDrawingMode(),
            onPenToolClick: () => this.handleTogglePenMode(),
            onAddText: () => this.handleToggleTextMode(),
            onDeleteSelected: this.deleteSelectedBoxes.bind(this),
            onUndoClick: this.handleUndo.bind(this),
            onRedoClick: this.handleRedo.bind(this),
            onResetView: this.handleResetView.bind(this),
            onResetStyles: this.handleResetStyles.bind(this),
            onToggleSelectionDrawing: () => this.handleToggleSelectionDrawing(),
            onAspectRatioChange: this.handleAspectRatioChange.bind(this),
        };
    }

    /**
     * @description Returns handlers for global style controls (color, font size, opacity).
     * @returns {Object.<string, Function>}
     */
    getStyleActionHandlers() {
        return {
            onStyleChange: this.handleStyleChange.bind(this),
            onFontSizeDown: () => this.handleFontSizeChange(-1, true),
            onFontSizeUp: () => this.handleFontSizeChange(1, true),
            onFontSizeInput: (e) => this.handleFontSizeChange(e.target.value, false),
            onOpacityDown: () => this.handleOpacityChange(-1, true),
            onOpacityUp: () => this.handleOpacityChange(1, true),
            onOpacityInput: (e) => this.handleOpacityChange(e.target.value, false),
        };
    }

    /**
     * @description Returns handlers for canvas-specific mouse and drag/drop events.
     * @returns {Object.<string, Function>}
     */
    getCanvasEventHandlers() {
        return {
            onCanvasMouseDown: this.handleMouseDown.bind(this),
            onCanvasMouseMove: this.handleMouseMove.bind(this),
            onCanvasMouseUp: this.handleMouseUp.bind(this),
            onCanvasDoubleClick: this.handleDoubleClick.bind(this),
            onCanvasWheel: this.handleWheel.bind(this),
            onCanvasDrop: this.handleCanvasDrop.bind(this),
            onCanvasFocus: () => { this.isCanvasFocused = true; },
            onCanvasBlur: () => { this.isCanvasFocused = false; },
        };
    }

    /**
     * @description Returns handlers for global keyboard and window events.
     * @returns {Object.<string, Function>}
     */
    getGlobalEventHandlers() {
        return {
            onKeyDown: this.handleKeyDown.bind(this),
            onKeyUp: this.handleKeyUp.bind(this),
            onWindowResize: this.onWindowResize.bind(this),
        };
    }

    /**
     * @description Returns handlers for modal interactions (zoom, help).
     * @returns {Object.<string, Function>}
     */
    getModalEventHandlers() {
        return {
            onZoomIn: this.handleZoomIn.bind(this),
            onZoomOut: this.handleZoomOut.bind(this),
            onFitToScreen: () => this.handleFitToScreen(this.view.DOMElements.canvas.width, this.view.DOMElements.canvas.height),
            onCloseHelpModal: this.view.hideHelpModal.bind(this.view),
        };
    }

    // --- Detailed Handler Implementations ---

    /** @description Toggles the collapsed state of the tools panel. */
    handleToggleTools() {
        const { toolsPanel, toolsToggleBtn } = this.view.DOMElements;
        toolsPanel.classList.toggle("collapsed");
        toolsToggleBtn.classList.toggle("collapsed");
        setTimeout(() => this.onWindowResize(), 50);
    }

    /** @description Toggles the collapsed state of the properties panel. */
    handleToggleProperties() {
        const { propertiesPanel, propertiesToggleBtn } = this.view.DOMElements;
        propertiesPanel.classList.toggle("collapsed");
        propertiesToggleBtn.classList.toggle("collapsed");
        setTimeout(() => this.onWindowResize(), 50);
    }

    /**
     * @description Handles the loading of a new image file.
     * @param {File} file - The image file to load.
     */
    handleImageLoad(file) {
        if (!file) return;
        this.view.showLoadingIndicator();
        const reader = new FileReader();
        reader.onload = (event) => {
            const newImage = new Image();
            newImage.onload = () => {
                this.model.resetAppState();
                this.model.image = newImage;
                this.model.scale = 1.0;
                this.model.panX = 0;
                this.model.panY = 0;
                this.onWindowResize();
                this.model.saveState();
                this.updateUI();
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
        this.view.DOMElements.imageLoader.value = "";
    }

    /** @description Shows the confirmation modal before unloading an image. */
    handleShowUnloadConfirm() {
        this.view.showUnloadConfirmModal();
    }

    /** @description Confirms unloading the image and resets the application state. */
    handleConfirmUnload() {
        this.view.hideUnloadConfirmModal();
        this.model.resetAppState();
        this.updateUI();
        this.view.DOMElements.canvas.removeAttribute("width");
        this.view.DOMElements.canvas.removeAttribute("height");
        this.view.DOMElements.imageLoader.value = "";
        this.view.DOMElements.jsonLoader.value = "";
         this.view.DOMElements.canvasContainer.focus();
    }

    /** @description Cancels the image unload action. */
    handleCancelUnload() {
        this.view.hideUnloadConfirmModal();
         this.view.DOMElements.canvasContainer.focus();
    }

    /**
     * @description Handles the import of annotations from a JSON file.
     * @param {File} file - The JSON file to import.
     */
    handleImportAnnotations(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const fileContent = event.target.result;
                const importedData = JSON.parse(fileContent);
                let importedBoxes;

                if (Array.isArray(importedData)) {
                    importedBoxes = importedData;
                } else if (importedData.annotations && Array.isArray(importedData.annotations)) {
                    importedBoxes = importedData.annotations;
                    if(importedData.imageData) this.view.showToast("Combined JSON detected. Loading annotations only.", "success");
                } else {
                    throw new Error("Invalid JSON format");
                }

                if (importedBoxes.length > 0 && typeof importedBoxes[0].x === 'undefined') {
                     throw new Error("Invalid annotation data structure.");
                }

                 this.model.boxes = [];
                 this.model.history = [];
                 this.model.redoStack = [];
                 this.model.nextId = 0;
                 this.model.selectedBoxId = null;

                this.model.currentAnnotations = importedBoxes;
                this.deselectAll(false);
                this.model.saveState();
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

    /** @description Handles exporting the current annotations to a JSON file. */
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

     /** @description Copies the annotated image and a generated prompt to the clipboard. */
    async handleCopyImageAndPrompt() {
         if (!this.model.image) {
             this.view.showToast("No image loaded for copy.", "error");
             return;
         }
         if (!navigator.clipboard || !navigator.clipboard.write) {
             this.view.showToast("Clipboard API not supported by your browser.", "error");
             return;
         }

         const { image, boxes, selectionRect } = this.model;
         const highResCanvas = this.renderer.createHighResCanvas(image, boxes, selectionRect);
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

    /** @description Saves the annotated image to a file. */
    handleSaveImageToFile() {
        if (!this.model.image) {
            this.view.showToast("No image loaded for save.", "error");
            return;
        }
        
        const { image, boxes, selectionRect } = this.model;
        const highResCanvas = this.renderer.createHighResCanvas(image, boxes, selectionRect);
        
        const link = document.createElement("a");
        link.download = "annotated-image.png";
        link.href = highResCanvas.toDataURL("image/png");
        link.click();
        this.view.showToast("Image download started.");
        this.view.closeExportModal();
    }

    /** @description Reverts the last action by restoring the previous state from history. */
    handleUndo() {
        if (this.model.undo()) {
            this.deselectAll(false);
            this.updateUI();
            this.view.showToast("Undo successful.");
        }
    }

    /** @description Re-applies an undone action from the redo stack. */
    handleRedo() {
        if (this.model.redo()) {
            this.deselectAll(false);
            this.updateUI();
            this.view.showToast("Redo successful.");
        }
    }

    /** @description Resets the canvas zoom and pan to their default states. */
    handleResetView() {
        this.model.scale = 1.0;
        this.model.panX = 0;
        this.model.panY = 0;
        this.updateUI();
        this.view.showToast("View reset");
    }

    /**
     * @description Handles changes to global style properties.
     * @param {string} property - The style property being changed ('color', 'fontSize', 'opacity').
     * @param {string|number} value - The new value for the property.
     */
    handleStyleChange(property, value) {
        if (property === 'color') {
            this.model.globalColor = value;
        } else if (property === 'fontSize') {
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue)) {
                 this.model.globalFontSize = Math.max(8, Math.min(48, numValue));
            }
        } else if (property === 'opacity') {
             const numValue = parseFloat(value);
             if (!isNaN(numValue)) {
                 this.model.globalOpacity = Math.max(0, Math.min(1, numValue));
             }
        }
        this.updateUI();
    }

    /**
     * @description Handles changes to the global font size.
     * @param {number} value - The value to change by or the new value.
     * @param {boolean} isRelative - If true, `value` is added to the current font size.
     */
    handleFontSizeChange(value, isRelative) {
        let newValue;
        const currentSize = this.model.globalFontSize;
        if (isRelative) {
            newValue = currentSize + value;
        } else {
            newValue = parseInt(value, 10);
        }
        newValue = Math.max(8, Math.min(48, newValue));
        if (!isNaN(newValue)) {
            this.model.globalFontSize = newValue;
        }
        this.updateUI();
    }

    /**
     * @description Handles changes to the global opacity.
     * @param {number} value - The value to change by or the new value.
     * @param {boolean} isRelative - If true, `value` is added to the current opacity percentage.
     */
    handleOpacityChange(value, isRelative) {
        let newPercent;
        const currentPercent = Math.round(this.model.globalOpacity * 100);
        if (isRelative) {
            newPercent = currentPercent + value;
        } else {
            newPercent = parseInt(value, 10);
        }
        newPercent = Math.max(0, Math.min(100, newPercent));
        if (!isNaN(newPercent)) {
            this.model.globalOpacity = newPercent / 100;
        }
        this.updateUI();
    }

    /** @description Resets global styles to their default values. */
    handleResetStyles() {
        this.model.resetGlobalStyles();
        this.updateUI();
        this.view.showToast("Styles reset to default");
    }

    /**
     * @description Toggles the bounding box drawing mode.
     * @param {boolean} [forceOff=false] - If true, ensures the mode is turned off.
     */
    handleToggleDrawingMode(forceOff = false) {
        if (!this.model.image && !forceOff) return;
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

    /**
     * @description Toggles the pen tool mode for drawing polygons.
     * @param {boolean} [forceOff=false] - If true, ensures the mode is turned off.
     */
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
        if (!shouldBeOn) this.updateUI();
    }

    /**
     * @description Toggles the text tool mode.
     * @param {boolean} [forceOff=false] - If true, ensures the mode is turned off.
     */
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

    /**
     * @description Toggles the selection drawing mode.
     * @param {boolean} [forceOff=false] - If true, ensures the mode is turned off.
     */
    handleToggleSelectionDrawing(forceOff = false) {
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
            if (!forceOff) this.model.selectionRect = null;
            this.view.DOMElements.drawSelectionBtn.classList.replace("btn-primary", "btn-secondary");
            this.view.DOMElements.drawSelectionBtn.querySelector("span").textContent = "Draw Selection";
        }
        this.updateCursorStyle();
        this.updateUI();
    }


    /** @description Updates the canvas cursor style based on the active tool or key press. */
    updateCursorStyle() {
        const { canvas } = this.view.DOMElements;
         if (this.isDrawingMode || this.isPenMode || this.isTextMode || this.isDrawingSelection) {
             canvas.style.cursor = "crosshair";
         } else if (this.keys["Space"]) {
             canvas.style.cursor = "grab";
         } else {
             canvas.style.cursor = "default";
             this.renderer.draw();
         }
    }

    /**
     * @description Handles changes to the aspect ratio for selection drawing.
     * @param {string} ratio - The new aspect ratio (e.g., "16:9").
     */
    handleAspectRatioChange(ratio) {
        this.currentAspectRatio = ratio;
        this.model.selectionRect = null;
        if (this.isDrawingSelection) {
            this.handleToggleSelectionDrawing(true);
            this.handleToggleSelectionDrawing(false);
        } else {
            this.updateUI();
        }
    }

    /**
     * @description Handles clicks on an annotation in the side list.
     * @param {number} id - The ID of the clicked annotation.
     * @param {boolean} multiSelect - Whether multi-select is active (e.g., Ctrl/Cmd key is pressed).
     */
    handleAnnotationListClick(id, multiSelect) {
        this.selectBox(id, multiSelect);
    }

    /**
     * @description Handles mouse hover over an annotation in the side list.
     * @param {number} id - The ID of the hovered annotation.
     */
    handleAnnotationListHover(id) {
        this.hoveredBoxId = id;
        this.view.updateAnnotationHighlight(id, true);
        this.renderer.draw();
    }

    /** @description Handles mouse leaving an annotation in the side list. */
    handleAnnotationListLeave() {
        this.view.updateAnnotationHighlight(this.hoveredBoxId, false);
        this.hoveredBoxId = null;
        this.renderer.draw();
    }

    /** @description Duplicates the currently selected annotation(s). */
    handleCopyAnnotation() {
        if (this.model.selectedBoxIds.length > 0) {
            this.model.selectedBoxIds.forEach(id => {
                const newBox = this.model.copyBox(id);
                if (newBox) {
                    this.model.saveState();
                    this.selectBox(newBox.id);
                }
            });
            this.view.showToast("Annotation(s) duplicated.");
        }
    }

    /** @description Selects all annotations. */
    handleSelectAll() {
        this.model.selectedBoxIds = this.model.boxes.map(b => b.id);
        this.updateUI();
    }

    /**
     * @description Zooms and pans the canvas to fit the entire image within the viewport.
     * @param {number} canvasWidth - The current width of the canvas.
     * @param {number} canvasHeight - The current height of the canvas.
     */
    handleFitToScreen(canvasWidth, canvasHeight) {
        if (!this.model.image) return;
        const { naturalWidth, naturalHeight } = this.model.image;
        const { width, height } = { width: canvasWidth, height: canvasHeight };
        const scaleX = width / naturalWidth;
        const scaleY = height / naturalHeight;
        this.model.scale = Math.min(scaleX, scaleY);
        this.model.panX = (width - naturalWidth * this.model.scale) / 2;
        this.model.panY = (height - naturalHeight * this.model.scale) / 2;
        this.updateUI();
    }

     /**
      * @description Initiates the text editing UI for an annotation.
      * @param {Event|null} event - The event that triggered the edit (e.g., click).
      * @param {number} boxId - The ID of the box to edit.
      */
     handleEditAnnotationText(event, boxId) {
        if (this.view.isEditingText) return;

         const box = this.model.boxes.find(b => b.id === boxId);
         if (box) {
            // Ensure the box is the *only* selected one when editing
             if (this.model.selectedBoxIds.length !== 1 || this.model.selectedBoxIds[0] !== boxId) {
                 this.selectBox(boxId);
             }
            this.view.createTextInput(box, (value) => {
                 const currentBox = this.model.boxes.find(b => b.id === box.id);
                 if (currentBox) {
                     const trimmedValue = value.trim();
                     if (currentBox.text !== trimmedValue && !(currentBox.text === "Not defined" && trimmedValue === "")) {
                         currentBox.text = trimmedValue ? trimmedValue : "Not defined";
                         this.model.saveState();
                     }
                     this.updateUI();
                 }
             });
         }
     }

    /**
     * @description Handles keydown events for keyboard shortcuts.
     * @param {KeyboardEvent} e - The keyboard event.
     */
    handleKeyDown(e) {
        this.keys[e.code] = true;

        if (e.code === 'Space' && !this.isPanning) {
             const activeEl = document.activeElement;
             const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
             if (!isTyping) {
                 e.preventDefault();
                 this.updateCursorStyle();
             }
        }

        if (e.key === 'Escape') {
             if (!this.view.DOMElements.unloadConfirmModal.classList.contains('hidden')) {
                this.handleCancelUnload(); return;
             }
             if (!this.view.DOMElements.exportModal.classList.contains('hidden')) {
                 this.view.closeExportModal(); return;
             }
        }

        const activeEl = document.activeElement;
        const isTypingInInput = activeEl && (activeEl.tagName === 'INPUT' && (activeEl.type === 'text' || activeEl.type === 'color' || activeEl.type === 'range') || activeEl.tagName === 'SELECT');

        if (this.view.isEditingText || isTypingInInput) {
             return;
        }

        if (this.isCanvasFocused) {
            if (this.model.image) {
                if (e.code === 'KeyB') { e.preventDefault(); this.handleToggleDrawingMode(); }
                if (e.code === 'KeyP') { e.preventDefault(); this.handleTogglePenMode(); }
                if (e.code === 'KeyT') { e.preventDefault(); this.handleToggleTextMode(); }
            }

             if (e.key === 'Escape') {
                 if (this.isPenMode) { this.handleTogglePenMode(); return; }
                 if (this.isDrawingSelection) { this.handleToggleSelectionDrawing(); return; }
                 if (this.isDrawing) {
                     this.isDrawing = false;
                     this.drawingRect = null;
                     if(this.isDrawingMode) this.handleToggleDrawingMode();
                     if(this.isTextMode) this.handleToggleTextMode();
                     this.updateUI();
                     return;
                 }
             }

            if (this.model.selectedBoxIds.length > 0) {
                if (e.code === "Delete" || e.code === "Backspace") { e.preventDefault(); this.deleteSelectedBoxes(); }
                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
                    e.preventDefault();
                    this.model.selectedBoxIds.forEach(id => {
                        const box = this.model.boxes.find((b) => b.id === id);
                        if (!box) return;
                        const amount = (this.keys["Shift"] ? 10 : 1) / this.model.scale;
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
                    this.renderer.draw();
                }
            }
        }

        if (e.key === '?') {
            e.preventDefault();
            this.view.showHelpModal();
        }
        if (e.ctrlKey || e.metaKey) {
            if (e.code === "KeyC") { e.preventDefault(); this.handleCopyAnnotation(); }
            if (e.code === "KeyA") { e.preventDefault(); this.handleSelectAll(); }
            if (e.code === "KeyZ") { e.preventDefault(); this.handleUndo(); }
            if (e.code === "KeyY") { e.preventDefault(); this.handleRedo(); }
            if (e.code === "KeyD" && this.model.selectionRect) {
                 e.preventDefault();
                 this.model.selectionRect = null;
                 this.handleToggleSelectionDrawing(true);
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
            this.handleFitToScreen(this.view.DOMElements.canvas.width, this.view.DOMElements.canvas.height);
        }
    }

    /**
     * @description Handles keyup events to reset key states and finalize actions.
     * @param {KeyboardEvent} e - The keyboard event.
     */
    handleKeyUp(e) {
        this.keys[e.code] = false;

        if (e.code === 'Space') {
            const activeEl = document.activeElement;
             const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
             if (!isTyping) {
                 e.preventDefault();
             }
            if(this.isPanning) this.isPanning = false;
            this.updateCursorStyle();
        }

        const activeEl = document.activeElement;
        const isTypingInInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT');
         if (this.view.isEditingText || isTypingInInput) {
             return;
        }

        if (this.isCanvasFocused && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && this.model.selectedBoxIds.length > 0) {
            this.model.saveState();
        }

        if (e.code !== 'Space') {
            this.updateCursor(e.clientX, e.clientY);
        }
    }

    /**
     * @description Handles mousedown events on the canvas to initiate actions like panning, drawing, or selecting.
     * @param {MouseEvent} e - The mouse event.
     */
    handleMouseDown(e) {
        this.view.DOMElements.canvas.focus();

        if (this.keys["Space"] || e.button === 1) {
            e.preventDefault();
            this.isPanning = true;
            this.panStartX = e.clientX - this.model.panX;
            this.panStartY = e.clientY - this.model.panY;
            this.view.DOMElements.canvas.style.cursor = 'grabbing';
            return;
        }
        if (e.button !== 0 || this.view.isEditingText) return;

        const mousePos = this.screenToWorld(e.clientX, e.clientY);
        this.startX = mousePos.x;
        this.startY = mousePos.y;

        if (this.isPenMode) {
            if (this.currentPath.length > 2) {
                const firstPoint = this.currentPath[0];
                const dist = Math.hypot(this.startX - firstPoint.x, this.startY - firstPoint.y);
                if (dist < 8 / this.model.scale) {
                    const newPoly = this.model.addPolygon(this.currentPath);
                    this.model.saveState();
                    this.handleTogglePenMode();
                    this.selectBox(newPoly.id);
                    this.handleEditAnnotationText(null, newPoly.id);
                    return;
                }
            }
            this.currentPath.push({ x: this.startX, y: this.startY });
            this.previewPoint = null;
            this.updateUI();
            return;
        }

        if (this.model.selectedBoxIds.length === 1) {
            const selectedBox = this.model.boxes.find((b) => b.id === this.model.selectedBoxIds[0]);
            const handles = this.renderer.getHandles(selectedBox, this.model.scale);
            const handleRadius = 8 / this.model.scale;
            const rotationRadius = 10 / this.model.scale;

            if (this.renderer.isPointInCircle(this.startX, this.startY, handles.rotation.x, handles.rotation.y, rotationRadius)) {
                this.isRotating = true; return;
            }

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

        for (let i = this.model.boxes.length - 1; i >= 0; i--) {
            const box = this.model.boxes[i];
            if (box.visible !== false && this.renderer.isPointInBox(this.startX, this.startY, box)) {
                if (!this.model.selectedBoxIds.includes(box.id)) {
                    this.selectBox(box.id, e.ctrlKey || e.metaKey);
                }
                this.isDragging = true;
                this.offsetX = this.startX - box.x;
                this.offsetY = this.startY - box.y;
                return;
            }
        }

        if (!this.isDragging && !this.isResizing && !this.isRotating) {
            this.deselectAll(false);
            if (this.isDrawingMode || this.isTextMode || this.isDrawingSelection) {
                this.isDrawing = true;
            }
            this.updateUI();
        }
    }

    /**
     * @description Handles mousemove events on the canvas for continuous actions like dragging, resizing, or drawing.
     * @param {MouseEvent} e - The mouse event.
     */
    handleMouseMove(e) {
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
        
        if (!this.isDrawing) {
            this.updateCursor(e.clientX, e.clientY);
        }

        if (boxes.length === 0) return;


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
            }
            box.angle = newAngle;
            this.renderer.draw();

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

            this.renderer.draw();

        } else if (this.isResizing && boxes.length === 1) {
            const box = boxes[0];
            const pivotX = this.offsetX; const pivotY = this.offsetY;
            const angle = box.angle;
            const cosA = Math.cos(angle); const sinA = Math.sin(angle);
            const dx = mouseX - pivotX; const dy = mouseY - pivotY;
            const rotatedMouseX = dx * cosA + dy * sinA;
            const rotatedMouseY = -dx * sinA + dy * cosA;
            let newWidth = box.w, newHeight = box.h;
            const minDim = 1 / this.model.scale;

            if (this.resizeHandle.includes('e')) newWidth = Math.max(minDim, rotatedMouseX);
            if (this.resizeHandle.includes('w')) newWidth = Math.max(minDim, -rotatedMouseX);
            if (this.resizeHandle.includes('s')) newHeight = Math.max(minDim, rotatedMouseY);
            if (this.resizeHandle.includes('n')) newHeight = Math.max(minDim, -rotatedMouseY);

            if (this.keys["Shift"] && ['nw', 'ne', 'sw', 'se'].includes(this.resizeHandle)) {
                 const aspectRatio = (box.w > 0 && box.h > 0) ? box.w / box.h : 1;
                  if (this.resizeHandle.includes('e') || this.resizeHandle.includes('w')) {
                      newHeight = newWidth / aspectRatio;
                  } else {
                      newWidth = newHeight * aspectRatio;
                  }
                  newWidth = Math.max(minDim, newWidth);
                  newHeight = Math.max(minDim, newHeight);

            }

            let rotatedCenterX = 0, rotatedCenterY = 0;
            if (this.resizeHandle.includes('e')) rotatedCenterX = newWidth / 2;
            if (this.resizeHandle.includes('w')) rotatedCenterX = -newWidth / 2;
            if (this.resizeHandle.includes('s')) rotatedCenterY = newHeight / 2;
            if (this.resizeHandle.includes('n')) rotatedCenterY = -newHeight / 2;

            const centerX = pivotX + rotatedCenterX * cosA - rotatedCenterY * sinA;
            const centerY = pivotY + rotatedCenterX * sinA + rotatedCenterY * cosA;

            const newX = centerX - (newWidth / 2 * cosA) + (newHeight / 2 * sinA);
            const newY = centerY - (newWidth / 2 * sinA) - (newHeight / 2 * cosA);

             if (box.type === 'poly') {
                 const oldW = box.w > 0 ? box.w : 1;
                 const oldH = box.h > 0 ? box.h : 1;
                 const scaleX = newWidth / oldW;
                 const scaleY = newHeight / oldH;

                 box.points = box.points.map(p => {
                      let vecX = p.x - pivotX; let vecY = p.y - pivotY;
                      let rotatedVecX = vecX * cosA + vecY * sinA;
                      let rotatedVecY = -vecX * sinA + vecY * cosA;

                       rotatedVecX *= scaleX;
                       rotatedVecY *= scaleY;

                      let finalVecX = rotatedVecX * cosA - rotatedVecY * sinA;
                      let finalVecY = rotatedVecX * sinA + rotatedVecY * cosA;
                      return { x: pivotX + finalVecX, y: pivotY + finalVecX };
                 });
             }

            box.x = newX; box.y = newY;
            box.w = newWidth; box.h = newHeight;
            this.renderer.draw();
        }
    }

    /**
     * @description Handles mouseup events on the canvas to finalize actions like drawing or transforming.
     * @param {MouseEvent} e - The mouse event.
     */
    handleMouseUp(e) {
        if (e.button !== 0) return;

        if (this.isPanning) {
            this.isPanning = false;
            this.updateCursorStyle();
            return;
        }

        const finalDrawingRect = this.drawingRect;
        this.drawingRect = null;

        if (this.isDrawing) {
            this.isDrawing = false;
             if (finalDrawingRect && finalDrawingRect.w > 5 && finalDrawingRect.h > 5) {
                 if (this.isDrawingSelection) {
                     this.model.selectionRect = finalDrawingRect;
                     this.handleToggleSelectionDrawing(true);
                 } else {
                     const newBox = this.model.addBox(finalDrawingRect);
                     if (this.isTextMode) {
                         newBox.isTextOnly = true;
                     }
                     this.model.saveState();
                     this.selectBox(newBox.id);
                     this.handleEditAnnotationText(null, newBox.id);

                      if (this.isDrawingMode) this.handleToggleDrawingMode(true);
                      if (this.isTextMode) this.handleToggleTextMode(true);
                 }
             } else {
                 if (this.isDrawingMode) this.handleToggleDrawingMode(true);
                 if (this.isTextMode) this.handleToggleTextMode(true);
                 if (this.isDrawingSelection) this.handleToggleSelectionDrawing(true);
             }
        }


        if (this.isDragging || this.isResizing || this.isRotating) {
            this.model.selectedBoxIds.forEach(id => {
                const box = this.model.boxes.find(b => b.id === id);
                if (box && box.type === 'poly') {
                    const { x, y, w, h } = this.model.calculateBoundingBox(box.points);
                    box.x = x; box.y = y; box.w = w; box.h = h;
                }
                if (box && (this.isResizing || this.isRotating)) {
                    box.w = Math.abs(box.w);
                    box.h = Math.abs(box.h);
                }
            });
            this.model.saveState();
        }

        this.isDragging = this.isResizing = this.isRotating = false;
        this.resizeHandle = null;
        this.startX = this.startY = this.offsetX = this.offsetY = 0;

        this.updateUI();
        this.updateCursor(e.clientX, e.clientY);
    }

     /**
      * @description Handles double-click events on the canvas to initiate text editing for an annotation.
      * @param {MouseEvent} e - The mouse event.
      */
     handleDoubleClick(e) {
         if (this.view.isEditingText) return;
         const mousePos = this.screenToWorld(e.clientX, e.clientY);
         for (let i = this.model.boxes.length - 1; i >= 0; i--) {
             const box = this.model.boxes[i];
             if (box.visible !== false && this.renderer.isPointInBox(mousePos.x, mousePos.y, box)) {
                this.selectBox(box.id);
                 this.handleEditAnnotationText(e, box.id);
                 return;
             }
         }
     }

    /**
     * @description Centralized function to handle zooming of the canvas.
     * @param {number} factor - The zoom factor (e.g., 1.1 for zoom in, 0.9 for zoom out).
     * @param {number} centerX - The x-coordinate of the zoom center (in screen space).
     * @param {number} centerY - The y-coordinate of the zoom center (in screen space).
     */
    zoomCanvas(factor, centerX, centerY) {
        if (!this.model.image) return;

        const oldScale = this.model.scale;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor));
        
        if (newScale === oldScale) return;

        const scaleRatio = newScale / oldScale;

        this.model.panX = centerX - (centerX - this.model.panX) * scaleRatio;
        this.model.panY = centerY - (centerY - this.model.panY) * scaleRatio;
        this.model.scale = newScale;

        this.renderer.draw();
        this.view.updateZoomDisplay(this.model.scale);
    }

    /**
     * @description Handles the mouse wheel event for zooming in and out.
     * @param {WheelEvent} e - The wheel event.
     */
    handleWheel(e) {
        if (!this.model.image || this.view.isEditingText) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        this.zoomCanvas(delta, mouseX, mouseY);
    }

     /** @description Handles the zoom-in action, typically from a button click. */
     handleZoomIn() {
        if (!this.model.image) return;
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        this.zoomCanvas(1.25, centerX, centerY);
    }

    /** @description Handles the zoom-out action, typically from a button click. */
    handleZoomOut() {
        if (!this.model.image) return;
        const rect = this.view.DOMElements.canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        this.zoomCanvas(0.8, centerX, centerY);
    }

    /**
     * @description Handles files dropped onto the canvas for loading images or annotations.
     * @param {DragEvent} e - The drag event.
     */
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

    /** @description Handles the window resize event to adjust the canvas size and maintain aspect ratio. */
    onWindowResize() {
        const { canvas, canvasContainer, unloadImageBtn, canvasControls } = this.view.DOMElements;
        const containerRect = canvasContainer.getBoundingClientRect();

        if (!this.model.image) {
             canvas.width = containerRect.width;
             canvas.height = containerRect.height;
             this.view.DOMElements.ctx.clearRect(0,0, canvas.width, canvas.height);
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

        if (oldCanvasWidth > 0 && oldCanvasHeight > 0 && (newCanvasWidth !== oldCanvasWidth || newCanvasHeight !== oldCanvasHeight)) {
             console.warn("Canvas resized, resetting view.");
             this.handleResetView();
        }

        const canvasOffsetX = (containerRect.width - newCanvasWidth) / 2;
        const canvasOffsetY = (containerRect.height - newCanvasHeight) / 2;
        unloadImageBtn.style.top = `${canvasOffsetY}px`;
        unloadImageBtn.style.right = `${canvasOffsetX}px`;

        if (this.model.image) {
            canvasControls.classList.remove('hidden');
            canvasControls.classList.add('flex');
        }

        this.renderer.draw();
        this.updateUI();
    }

}
